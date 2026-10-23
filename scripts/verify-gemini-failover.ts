import assert from "node:assert/strict";
import {
  GEMINI_HTTP_TIMEOUT_MS,
  geminiErrorStatus,
  geminiGenerationConfig,
  getGeminiModelCandidates,
  rememberSuccessfulGeminiModel,
  shouldTryAnotherGeminiModel,
  shouldRetryGeminiTransiently,
} from "../lib/gemini/model-routing";

const originalModel = process.env.GEMINI_MODEL_ID;
const originalFallbacks = process.env.GEMINI_FALLBACK_MODEL_IDS;
try {
  process.env.GEMINI_MODEL_ID = "gemini-3.6-flash";
  delete process.env.GEMINI_FALLBACK_MODEL_IDS;
  assert.ok(GEMINI_HTTP_TIMEOUT_MS >= 10_000, "Gemini HTTP timeout must meet the API minimum deadline");
  const initial = getGeminiModelCandidates();
  assert.deepEqual(initial, ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]);

  assert.equal(geminiErrorStatus({ status: 503, message: "UNAVAILABLE" }), 503);
  assert.equal(geminiErrorStatus({ message: '{"error":{"code":503,"status":"UNAVAILABLE"}}' }), 503);
  assert.equal(shouldTryAnotherGeminiModel({ status: 503, message: "high demand" }), true);
  assert.equal(shouldTryAnotherGeminiModel({ status: 429, message: "quota" }), true);
  assert.equal(shouldTryAnotherGeminiModel({ status: 403, message: "permission denied" }), false);
  assert.equal(shouldRetryGeminiTransiently({ status: 503, message: "high demand" }), true);
  assert.equal(shouldRetryGeminiTransiently({ status: 429, message: "quota" }), true);
  assert.equal(shouldRetryGeminiTransiently({ status: 400, message: "invalid argument" }), false);

  const flashLiteConfig = geminiGenerationConfig("gemini-3.5-flash-lite", 700, true) as Record<string, unknown>;
  assert.equal(flashLiteConfig.responseMimeType, "application/json");
  assert.equal("thinkingConfig" in flashLiteConfig, false);
  const flashConfig = geminiGenerationConfig("gemini-3.6-flash", 700, true) as Record<string, unknown>;
  assert.deepEqual(flashConfig.thinkingConfig, { thinkingLevel: "low" });

  rememberSuccessfulGeminiModel("gemini-3.5-flash-lite");
  assert.equal(getGeminiModelCandidates()[0], "gemini-3.5-flash-lite");
  console.log("PASS: Gemini model candidate order, overload failover decisions, config compatibility, and recent-success preference");
} finally {
  if (originalModel === undefined) delete process.env.GEMINI_MODEL_ID;
  else process.env.GEMINI_MODEL_ID = originalModel;
  if (originalFallbacks === undefined) delete process.env.GEMINI_FALLBACK_MODEL_IDS;
  else process.env.GEMINI_FALLBACK_MODEL_IDS = originalFallbacks;
}
