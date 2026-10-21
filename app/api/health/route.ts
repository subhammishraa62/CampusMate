import { NextResponse } from "next/server";
import { getBedrockConfiguration } from "@/lib/bedrock/daily-brief";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const bedrock = getBedrockConfiguration();
  return NextResponse.json({
    status: "ok",
    app: "CampusMate AI",
    capabilities: {
      rulesBasedBrief: true,
      amazonBedrockEnabled: bedrock.enabled,
      bedrockRegion: bedrock.region,
      bedrockModelId: bedrock.modelId,
      supabaseAuthAndStorageConfigured: Boolean(getSupabaseConfig()),
      alexaPlusMcp: "Streamable HTTP endpoint at /api/mcp",
      mcpBearerTokenConfigured: Boolean(process.env.CAMPUSMATE_MCP_TOKEN),
    },
    note: "Configuration indicators do not verify AWS credentials, Bedrock model access, or database connectivity. Use the in-app MCP test and API logs for runtime checks.",
  }, { headers: { "Cache-Control": "no-store" } });
}
