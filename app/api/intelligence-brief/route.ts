import { NextRequest, NextResponse } from "next/server";
import { buildRuleBasedBrief, sanitizePlannerTasks } from "@/lib/planning/engine";
import type { DailyBrief, PlannerTask } from "@/lib/planning/types";
import { buildBedrockBrief, getBedrockConfiguration, isBedrockEnabled } from "@/lib/bedrock/daily-brief";
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
  const config = getBedrockConfiguration();
  let canUseBedrock = isBedrockEnabled();
  let authRequired = false;

  // On production deployments, model calls are limited to signed-in students.
  if (canUseBedrock && process.env.NODE_ENV === "production") {
    if (!getSupabaseConfig()) {
      canUseBedrock = false;
      authRequired = true;
    } else {
      try {
        const supabase = await createSupabaseServerClient();
        const { data, error } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
        if (error || !data.user) {
          canUseBedrock = false;
          authRequired = true;
        }
      } catch {
        canUseBedrock = false;
        authRequired = true;
      }
    }
  }

  let aiBrief: DailyBrief | null = null;
  let bedrockStatus: "disabled" | "ready" | "unavailable" = "disabled";
  if (canUseBedrock) {
    const result = await buildBedrockBrief(tasks, context);
    aiBrief = result.brief;
    bedrockStatus = result.status;
  }

  const brief = aiBrief ?? buildRuleBasedBrief(tasks, context);
  let note: string | undefined;
  if (aiBrief) {
    note = `Generated with Amazon Bedrock · ${config.modelId} · ${config.region}`;
  } else if (authRequired) {
    note = "Amazon Bedrock is configured, but production AI requests require a signed-in Supabase account. The rules-based planner is active meanwhile.";
  } else if (!isBedrockEnabled()) {
    note = "Rules-based planning is active. Configure AWS credentials, model access, and BEDROCK_ENABLED=true to enable Amazon Bedrock.";
  } else if (bedrockStatus === "unavailable") {
    note = "Amazon Bedrock could not complete this request. CampusMate safely used its rules-based planning engine instead; check your AWS region, credentials, model access, and IAM permissions.";
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
