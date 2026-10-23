import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { GEMINI_HTTP_TIMEOUT_MS, geminiGenerationConfig, getGeminiModelCandidates, pauseBeforeGeminiFallback, pauseBeforeGeminiRetry, rememberSuccessfulGeminiModel, sanitizedGeminiError, shouldRetryGeminiTransiently, shouldTryAnotherGeminiModel } from "@/lib/gemini/model-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buckets = new Map<string, { start: number; count: number }>();

function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const previous = buckets.get(key);
  if (!previous || now - previous.start >= 60_000) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (previous.count >= 12) return false;
  previous.count += 1;
  return true;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!withinRateLimit(ip)) return NextResponse.json({ error: "CampusMate chat is busy. Wait a minute and try again." }, { status: 429 });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Google Gemini is not configured yet. Add GEMINI_API_KEY to your server-side .env.local file, then restart CampusMate." }, { status: 503 });
  }

  if (process.env.NODE_ENV === "production") {
    if (!getSupabaseConfig()) return NextResponse.json({ error: "Configure sign-in before enabling production AI chat." }, { status: 503 });
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
      if (error || !data.user) return NextResponse.json({ error: "Sign in to use CampusMate AI chat." }, { status: 401 });
    } catch {
      return NextResponse.json({ error: "Could not verify your session. Please sign in again." }, { status: 401 });
    }
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  const input = raw as Record<string, unknown>;
  const message = clip(input.message, 1000);
  if (!message) return NextResponse.json({ error: "Enter a message first." }, { status: 400 });

  const tasks = Array.isArray(input.tasks) ? input.tasks.slice(0, 30).map((rawTask) => {
    if (!rawTask || typeof rawTask !== "object") return null;
    const t = rawTask as Record<string, unknown>;
    return {
      title: clip(t.title, 160), detail: clip(t.detail, 200), done: t.done === true,
      priority: ["Low", "Medium", "High"].includes(String(t.priority)) ? String(t.priority) : "Medium",
      deadlineDate: clip(t.deadlineDate, 10), deadlineTime: clip(t.deadlineTime, 5),
      scheduledDate: clip(t.scheduledDate, 10), startTime: clip(t.startTime, 5), endTime: clip(t.endTime, 5),
    };
  }).filter(Boolean) : [];
  const courses = Array.isArray(input.courses) ? input.courses.slice(0, 20).map((rawCourse) => {
    if (!rawCourse || typeof rawCourse !== "object") return null;
    const c = rawCourse as Record<string, unknown>;
    return { title: clip(c.title, 120), code: clip(c.course_code, 32) };
  }).filter(Boolean) : [];
  const classes = Array.isArray(input.classes) ? input.classes.slice(0, 20).map((rawClass) => {
    if (!rawClass || typeof rawClass !== "object") return null;
    const c = rawClass as Record<string, unknown>;
    return { title: clip(c.title, 120), starts_at: clip(c.starts_at, 40), ends_at: clip(c.ends_at, 40), course_id: clip(c.course_id, 80) };
  }).filter(Boolean) : [];

  const prompt = [
    "You are CampusMate, a warm, practical AI student-life assistant.",
    "Help the student understand their tasks, courses, classes, deadlines, and planning choices using only the context supplied below.",
    "Never invent a saved task, class, course, deadline, or available time. If information is missing, say so. Do not claim to have saved, created, edited, or scheduled anything; the app requires the student to confirm changes in the Planning Studio.",
    "Be concise and conversational. Prefer 2-5 sentences or a short compact list. If asked to plan work, respect class sessions as fixed commitments and clearly identify suggestions as suggestions.",
    `Current local time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (Asia/Kolkata).`,
    `Student context JSON: ${JSON.stringify({ tasks, courses, classes })}`,
    `Student message: ${message}`,
  ].join("\n\n");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_HTTP_TIMEOUT_MS,
      retryOptions: { attempts: 1 },
    },
  });
  const modelIds = getGeminiModelCandidates();
  let lastError: unknown = null;
  let transientRetryUsed = false;
  modelLoop: for (let index = 0; index < modelIds.length; index += 1) {
    const modelId = modelIds[index];
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: prompt,
          config: geminiGenerationConfig(modelId, 600) as never,
        });
        const reply = typeof response.text === "string" ? response.text.trim() : "";
        if (!reply) throw new Error(`Model ${modelId} returned an empty response.`);
        rememberSuccessfulGeminiModel(modelId);
        return NextResponse.json({ reply, provider: "Google Gemini", modelId }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        lastError = error;
        const details = sanitizedGeminiError(error, apiKey);
        console.warn("[CampusMate] Gemini chat model attempt failed.", { modelId, attempt, ...details });
        if (!shouldTryAnotherGeminiModel(error)) break modelLoop;
        if (!transientRetryUsed && shouldRetryGeminiTransiently(error)) {
          transientRetryUsed = true;
          await pauseBeforeGeminiRetry(1);
          continue;
        }
        break;
      }
    }
    if (index < modelIds.length - 1) await pauseBeforeGeminiFallback();
  }
  const details = lastError ? sanitizedGeminiError(lastError, apiKey) : { name: "UnknownGeminiError", status: "unknown" as const, message: "No model candidates were configured." };
  console.error("[CampusMate] All Gemini chat model attempts failed.", details);
  return NextResponse.json({ error: "Gemini is temporarily unavailable across the configured models. Your tasks and schedule are unchanged. Try again shortly; the VS Code terminal has the status details." }, { status: 502 });
}
