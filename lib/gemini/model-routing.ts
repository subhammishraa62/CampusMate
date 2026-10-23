/** Small, bounded Gemini model failover for temporary provider overloads. */
// Prefer the high-throughput Flash-Lite model for short planner responses.
// The other currently supported stable Flash IDs are kept as bounded fallbacks.
const DEFAULT_PRIMARY_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
const MAX_MODELS_PER_REQUEST = 3;
// The Gemini API rejects manually supplied deadlines below 10 seconds.
// Keep this comfortably above the documented minimum, including integer rounding.
export const GEMINI_HTTP_TIMEOUT_MS = 12_000;
let lastSuccessfulModel: string | null = null;

export function getGeminiModelCandidates(primaryOverride?: string): string[] {
  const primary = primaryOverride?.trim() || process.env.GEMINI_MODEL_ID?.trim() || DEFAULT_PRIMARY_MODEL;
  const configuredFallbacks = (process.env.GEMINI_FALLBACK_MODEL_IDS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  // Prefer a model that has recently succeeded, then try the configured primary and
  // a lower-cost/high-throughput fallback before returning to rules-based planning.
  return [...new Set([lastSuccessfulModel || "", primary, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS])]
    .filter(Boolean)
    .slice(0, MAX_MODELS_PER_REQUEST);
}

export function rememberSuccessfulGeminiModel(modelId: string): void {
  lastSuccessfulModel = modelId;
}

export function geminiGenerationConfig(modelId: string, maxOutputTokens: number, json = false) {
  const config: Record<string, unknown> = { maxOutputTokens };
  // Gemini 3.6/3.8 support configurable thinking. Keep the Lite fallback on its
  // default config so an unsupported thinking field cannot prevent failover.
  if (/^gemini-3\.(6|8)-flash$/.test(modelId)) {
    config.thinkingConfig = { thinkingLevel: "low" };
  }
  if (json) config.responseMimeType = "application/json";
  return config;
}

export function geminiErrorStatus(error: unknown): number | null {
  if (error && typeof error === "object") {
    const details = error as { status?: unknown; statusCode?: unknown; message?: unknown };
    const direct = Number(details.status ?? details.statusCode);
    if (Number.isFinite(direct) && direct >= 400 && direct <= 599) return direct;
    const message = String(details.message ?? "");
    const jsonCode = message.match(/(?:"code"\s*:\s*|status(?:Code)?[=:\s]+)(4\d\d|5\d\d)/i);
    if (jsonCode) return Number(jsonCode[1]);
  }
  const message = String(error ?? "");
  const match = message.match(/\b(400|401|402|403|404|408|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

export function shouldTryAnotherGeminiModel(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  // These generally affect the key/account as a whole, so trying other models
  // only burns time. A 404/429/5xx can be model- or capacity-specific.
  if (status === 401 || status === 403) return false;
  if (/api key not valid|invalid api key|permission denied|key was reported as leaked/.test(message)) return false;
  return true;
}

export function sanitizedGeminiError(error: unknown, apiKey: string): { name: string; status: number | "unknown"; message: string } {
  const details = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown }
    : {};
  const rawMessage = String(details.message ?? error ?? "Unknown Gemini error");
  const message = rawMessage
    .replaceAll(apiKey, "[REDACTED_API_KEY]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .slice(0, 600);
  return {
    name: String(details.name ?? "UnknownGeminiError"),
    status: geminiErrorStatus(error) ?? "unknown",
    message,
  };
}

export function shouldRetryGeminiTransiently(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** One bounded retry after a transient provider failure; never wait indefinitely. */
export async function pauseBeforeGeminiRetry(attempt = 1): Promise<void> {
  const backoff = Math.min(2_500, 900 * 2 ** Math.max(0, attempt - 1));
  await new Promise((resolve) => setTimeout(resolve, backoff + Math.floor(Math.random() * 350)));
}

export async function pauseBeforeGeminiFallback(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180 + Math.floor(Math.random() * 220)));
}
