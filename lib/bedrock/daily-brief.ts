import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { DailyBrief, PlannerTask } from "@/lib/planning/types";
import { buildRuleBasedBrief } from "@/lib/planning/engine";

const region = process.env.AWS_REGION || "ap-south-1";
const modelId = process.env.BEDROCK_MODEL_ID || "global.amazon.nova-2-lite-v1:0";
const client = new BedrockRuntimeClient({ region });

export function isBedrockEnabled(): boolean {
  return process.env.BEDROCK_ENABLED === "true";
}

export function getBedrockConfiguration() {
  return { enabled: isBedrockEnabled(), region, modelId };
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
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

function normalizeModelBrief(value: Record<string, unknown>, tasks: PlannerTask[]): DailyBrief | null {
  const strings = value.nextSteps;
  const plan = value.plan;
  if (!Array.isArray(strings) || strings.length !== 3 || !strings.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(plan) || plan.length !== 3) return null;
  if (!plan.every((item) => !!item && typeof item === "object")) return null;

  const taskIds = new Set(tasks.map((task) => String(task.id)));
  const requestedId = typeof value.priorityTaskId === "string" ? value.priorityTaskId : null;
  const priorityTaskId = requestedId && taskIds.has(requestedId) ? requestedId : null;
  const fallback = buildRuleBasedBrief(tasks);
  const priorityTitle = priorityTaskId
    ? tasks.find((task) => String(task.id) === priorityTaskId)?.title ?? fallback.priorityTitle
    : tasks.every((task) => task.done)
      ? "Nothing urgent is waiting"
      : fallback.priorityTitle;

  return {
    headline: cleanString(value.headline, fallback.headline, 100),
    summary: cleanString(value.summary, fallback.summary, 500),
    priorityTaskId,
    priorityTitle,
    reason: cleanString(value.reason, fallback.reason, 700),
    nextSteps: strings.map((item, index) => cleanString(item, fallback.nextSteps[index], 220)),
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

/**
 * Calls Amazon Bedrock's Converse API when explicitly enabled. Returns null on
 * missing model access, missing credentials, timeouts, or invalid model output;
 * callers can safely fall back to the deterministic planning engine.
 */
export async function buildBedrockBrief(
  tasks: PlannerTask[],
  context = "",
): Promise<{ brief: DailyBrief | null; status: "disabled" | "ready" | "unavailable" }> {
  if (!isBedrockEnabled()) return { brief: null, status: "disabled" };

  const rulesBrief = buildRuleBasedBrief(tasks, context);
  try {
    const response = await client.send(new ConverseCommand({
      modelId,
      system: [{
        text: [
          "You are CampusMate, a careful and warm student-planning assistant.",
          "Use only the provided task records and user context. Never invent deadlines, courses, classes, available time, locations, grades, or tasks.",
          "A class is a fixed commitment; prefer an unfinished study or life task for the next best move when appropriate.",
          "Keep recommendations realistic, compassionate, non-judgmental, and short. Preserve rest and do not claim a plan was saved.",
          "Return exactly one valid JSON object and no Markdown with keys: headline, summary, priorityTaskId, priorityTitle, reason, nextSteps (exactly 3 strings), plan (exactly 3 objects with time, title, detail).",
          "priorityTaskId must exactly match one supplied task id or be null. Do not create new task ids.",
        ].join(" "),
      }],
      messages: [{
        role: "user",
        content: [{ text: JSON.stringify({ context: context.slice(0, 600), tasks, deterministicBaseline: rulesBrief }) }],
      }],
      inferenceConfig: { maxTokens: 1200, temperature: 0.2, topP: 0.85 },
    }), { abortSignal: AbortSignal.timeout(20_000) });

    const content = response.output?.message?.content ?? [];
    const modelText = content
      .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    const parsed = parseJsonObject(modelText);
    if (!parsed) return { brief: null, status: "unavailable" };
    const brief = normalizeModelBrief(parsed, tasks);
    return brief ? { brief, status: "ready" } : { brief: null, status: "unavailable" };
  } catch (error) {
    // Log only a safe high-level signal; do not echo credentials or raw request details.
    const name = error instanceof Error ? error.name : "UnknownBedrockError";
    console.warn(`[CampusMate] Amazon Bedrock brief unavailable (${name}). Falling back to rules.`);
    return { brief: null, status: "unavailable" };
  }
}
