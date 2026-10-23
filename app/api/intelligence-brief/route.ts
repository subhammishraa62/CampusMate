import { NextRequest, NextResponse } from "next/server";
import { buildRuleBasedBrief, sanitizePlannerTasks } from "@/lib/planning/engine";
import type { DailyBrief, PlannerTask } from "@/lib/planning/types";
import { buildBedrockBrief, getBedrockConfiguration, isBedrockEnabled } from "@/lib/bedrock/daily-brief";
import { buildGeminiBrief, getGeminiConfiguration, isGeminiEnabled } from "@/lib/gemini/daily-brief";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateBuckets = new Map<string, { startedAt: number; count: number }>();

function rateLimitKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function isWithinRateLimit(key: string) {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (rateBuckets.size > 1_000) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= 60_000) rateBuckets.delete(bucketKey);
    }
  }
  if (!existing || now - existing.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (existing.count >= 20) return false;
  existing.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  if (!isWithinRateLimit(rateLimitKey(request))) {
    return NextResponse.json({ error: "You've refreshed the brief a lot in a short time. Wait a minute and try again." }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  let tasks: PlannerTask[];
  try { tasks = sanitizePlannerTasks(input.tasks); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid task list." }, { status: 400 });
  }
  const context = typeof input.context === "string" ? input.context.trim().slice(0, 600) : "";
  const learningContext = typeof input.learningContext === "string" ? input.learningContext.trim().slice(0, 500) : "";
  const modelContext = [context, learningContext].filter(Boolean).join("\n\n").slice(0, 1100);
  const bedrockConfig = getBedrockConfiguration();
  const geminiConfig = getGeminiConfiguration();
  const canUseExternalAI = isGeminiEnabled() || isBedrockEnabled();
  let authRequired = false;

  // In production, do not turn this route into an anonymous external model proxy.
  if (canUseExternalAI && process.env.NODE_ENV === "production") {
    if (!getSupabaseConfig()) {
      authRequired = true;
    } else {
      try {
        const supabase = await createSupabaseServerClient();
        const { data, error } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
        if (error || !data.user) authRequired = true;
      } catch {
        authRequired = true;
      }
    }
  }

  let aiBrief: DailyBrief | null = null;
  let providerUsed: "Google Gemini" | "Amazon Bedrock" | null = null;
  let geminiStatus: "disabled" | "ready" | "unavailable" = "disabled";
  let geminiModelUsed: string | null = null;
  let bedrockStatus: "disabled" | "ready" | "unavailable" = "disabled";

  // Prefer Gemini when configured; fall back to Bedrock if it is also enabled,
  // then to the deterministic local planner. No AWS setup is needed for Gemini.
  if (!authRequired && isGeminiEnabled()) {
    const result = await buildGeminiBrief(tasks, modelContext);
    geminiStatus = result.status;
    if (result.brief) {
      aiBrief = result.brief;
      providerUsed = "Google Gemini";
      geminiModelUsed = result.modelId || geminiConfig.modelId;
    }
  }
  if (!authRequired && !aiBrief && isBedrockEnabled()) {
    const result = await buildBedrockBrief(tasks, modelContext);
    bedrockStatus = result.status;
    if (result.brief) {
      aiBrief = result.brief;
      providerUsed = "Amazon Bedrock";
    }
  }

  const brief = aiBrief ?? buildRuleBasedBrief(tasks, context);
  let note: string | undefined;
  if (providerUsed === "Google Gemini") {
    note = `Generated with Google Gemini · ${geminiModelUsed || geminiConfig.modelId}`;
  } else if (providerUsed === "Amazon Bedrock") {
    note = `Generated with Amazon Bedrock · ${bedrockConfig.modelId} · ${bedrockConfig.region}`;
  } else if (authRequired) {
    note = "External AI requests in production require a signed-in Supabase account. The rules-based planner is active meanwhile.";
  } else if (geminiStatus === "unavailable" || bedrockStatus === "unavailable") {
    note = "The configured AI provider could not complete this request. CampusMate safely used its rules-based planning engine instead; check the provider key, model access, and usage limits.";
  } else if (!isGeminiEnabled() && !isBedrockEnabled()) {
    note = "Rules-based planning is active. Add GEMINI_API_KEY to enable Google Gemini, or configure Amazon Bedrock if you have access.";
  } else {
    note = "CampusMate's rules-based planning engine is active.";
  }

  const result: DailyBrief = {
    ...brief,
    note,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json({ brief: result }, { headers: { "Cache-Control": "no-store" } });
}
