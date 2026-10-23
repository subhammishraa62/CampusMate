import { NextResponse } from "next/server";
import { getBedrockConfiguration } from "@/lib/bedrock/daily-brief";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { getGeminiConfiguration } from "@/lib/gemini/daily-brief";

export const dynamic = "force-dynamic";

export async function GET() {
  const bedrock = getBedrockConfiguration();
  const gemini = getGeminiConfiguration();
  return NextResponse.json({
    status: "ok",
    app: "CampusMate AI",
    capabilities: {
      rulesBasedBrief: true,
      googleGeminiEnabled: gemini.enabled,
      geminiModelId: gemini.modelId,
      geminiFallbackModelIds: gemini.fallbackModelIds,
      amazonBedrockEnabled: bedrock.enabled,
      bedrockRegion: bedrock.region,
      bedrockModelId: bedrock.modelId,
      supabaseAuthAndStorageConfigured: Boolean(getSupabaseConfig()),
      alexaPlusMcp: "Streamable HTTP endpoint at /api/mcp",
      mcpBearerTokenConfigured: Boolean(process.env.CAMPUSMATE_MCP_TOKEN),
    },
    note: "Configuration indicators do not verify Gemini or Bedrock inference access, or database connectivity. Use the in-app MCP test and API logs for runtime checks.",
  }, { headers: { "Cache-Control": "no-store" } });
}
