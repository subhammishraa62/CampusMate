import { GoogleGenAI } from "@google/genai";
import type { DailyBrief, PlannerTask } from "@/lib/planning/types";
import { buildRuleBasedBrief } from "@/lib/planning/engine";
import {
  GEMINI_HTTP_TIMEOUT_MS,
  geminiGenerationConfig,
  getGeminiModelCandidates,
  pauseBeforeGeminiFallback,
  pauseBeforeGeminiRetry,
  rememberSuccessfulGeminiModel,
  sanitizedGeminiError,
  shouldRetryGeminiTransiently,
  shouldTryAnotherGeminiModel,
} from "@/lib/gemini/model-routing";

const DEFAULT_MODEL_ID = "gemini-3.5-flash-lite";

export function isGeminiEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiConfiguration() {
  const modelId = process.env.GEMINI_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  return {
    enabled: isGeminiEnabled(),
    modelId,
    fallbackModelIds: getGeminiModelCandidates(modelId).filter((model) => model !== modelId),
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function cleanString(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function normalizeModelBrief(value: Record<string, unknown>, tasks: PlannerTask[]): DailyBrief | null {
  const nextSteps = value.nextSteps;
  const plan = value.plan;
  if (!Array.isArray(nextSteps) || nextSteps.length !== 3 || !nextSteps.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(plan) || plan.length !== 3 || !plan.every((item) => !!item && typeof item === "object" && !Array.isArray(item))) return null;

  const taskIds = new Set(tasks.map((task) => String(task.id)));
  const requestedId = typeof value.priorityTaskId === "string" ? value.priorityTaskId : null;
  const priorityTaskId = requestedId && taskIds.has(requestedId) ? requestedId : null;
  const fallback = buildRuleBasedBrief(tasks);
  const priorityTitle = priorityTaskId
    ? tasks.find((task) => String(task.id) === priorityTaskId)?.title ?? fallback.priorityTitle
    : tasks.every((task) => task.done) ? "Nothing urgent is waiting" : fallback.priorityTitle;

  return {
    headline: cleanString(value.headline, fallback.headline, 100),
    summary: cleanString(value.summary, fallback.summary, 500),
    priorityTaskId,
    priorityTitle,
    reason: cleanString(value.reason, fallback.reason, 700),
    nextSteps: nextSteps.map((item, index) => cleanString(item, fallback.nextSteps[index], 220)),
    plan: plan.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const fallbackItem = fallback.plan[index];
      return {
        time: cleanString(item.time, fallbackItem.time, 60),
        title: cleanString(item.title, fallbackItem.title, 140),
        detail: cleanString(item.detail, fallbackItem.detail, 240),
      };
    }),
    engine: "ai",
  };
}

/** Server-side Gemini provider with bounded model failover for temporary 429/5xx errors. */
export async function buildGeminiBrief(
  tasks: PlannerTask[],
  context = "",
): Promise<{ brief: DailyBrief | null; status: "disabled" | "ready" | "unavailable"; modelId?: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { brief: null, status: "disabled" };

  const modelIds = getGeminiModelCandidates();
  const baseline = buildRuleBasedBrief(tasks, context);
  const prompt = [
    "You are CampusMate, a careful and warm student-planning assistant.",
    "Use only the provided task records and user context. Never invent deadlines, courses, classes, free time, locations, grades, or tasks.",
    "Classes are fixed commitments. Do not claim that a plan was saved or that you changed the schedule.",
    "Keep recommendations realistic, compassionate, non-judgmental, and short.",
    "Return exactly one valid JSON object and no Markdown with keys: headline, summary, priorityTaskId, priorityTitle, reason, nextSteps (exactly 3 strings), plan (exactly 3 objects with time, title, detail).",
    "priorityTaskId must exactly match one supplied task id or be null. Do not create task IDs. Proposed plan times are suggestions only; the app's scheduler separately checks conflicts.",
    `Input JSON: ${JSON.stringify({ context: context.slice(0, 1100), tasks, deterministicBaseline: baseline })}`,
  ].join("\n\n");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_HTTP_TIMEOUT_MS,
      retryOptions: { attempts: 1 },
    },
  });
  let lastError: unknown = null;
  // A single retry is shared across the whole request, so a temporary 429/503
  // gets a brief backoff without making the UI wait through unbounded retries.
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
          config: geminiGenerationConfig(modelId, 900, true) as never,
        });
        const responseText = typeof response.text === "string" ? response.text : "";
        const parsed = parseJsonObject(responseText);
        const brief = parsed ? normalizeModelBrief(parsed, tasks) : null;
        if (brief) {
          rememberSuccessfulGeminiModel(modelId);
          return { brief, status: "ready", modelId };
        }
        lastError = new Error(`Model ${modelId} returned empty or invalid JSON for the planning brief.`);
        console.warn("[CampusMate] Gemini response did not match the planning schema; trying another model.", { modelId, attempt });
        break;
      } catch (error) {
        lastError = error;
        const details = sanitizedGeminiError(error, apiKey);
        console.warn("[CampusMate] Gemini model attempt failed.", { modelId, attempt, ...details });
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
  if (lastError) {
    const details = sanitizedGeminiError(lastError, apiKey);
    console.error("[CampusMate] All configured Gemini model attempts failed; using rules-based fallback.", details);
  }
  return { brief: null, status: "unavailable", modelId: modelIds[0] };
}
