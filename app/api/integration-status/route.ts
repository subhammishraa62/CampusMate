import { NextResponse } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const tableNames = ["tasks", "courses", "class_sessions", "study_sessions", "study_plans"] as const;
type TableName = (typeof tableNames)[number];

type TableCheck = { status: "ok" | "error" | "not_checked"; hint?: string };

/**
 * Safe diagnostics only: return configuration/access indicators, never row contents,
 * user IDs, tokens, raw SQL errors, or secrets. Checks are read-only.
 */
export async function GET() {
  const config = getSupabaseConfig();
  const bedrockEnabled = process.env.BEDROCK_ENABLED === "true";
  const bedrockModelId = process.env.BEDROCK_MODEL_ID || "global.amazon.nova-2-lite-v1:0";
  const bedrockRegion = process.env.AWS_REGION || "ap-south-1";
  const mcpTokenConfigured = Boolean(process.env.CAMPUSMATE_MCP_TOKEN);

  const base: {
    checkedAt: string;
    supabase: { configured: boolean; authenticated: boolean; authStatus: string; tables: Record<TableName, TableCheck> };
    bedrock: { enabled: boolean; modelId: string; region: string; credentialOrInvocationTested: boolean; note: string };
    mcp: { endpoint: string; transport: string; sharedTokenConfigured: boolean; remoteAlexaPlusReady: boolean; note: string };
  } = {
    checkedAt: new Date().toISOString(),
    supabase: {
      configured: Boolean(config),
      authenticated: false,
      authStatus: config ? "not_checked" as const : "needs_configuration" as const,
      tables: Object.fromEntries(tableNames.map((name) => [name, { status: "not_checked" as const }])) as Record<TableName, TableCheck>,
    },
    bedrock: {
      enabled: bedrockEnabled,
      modelId: bedrockModelId,
      region: bedrockRegion,
      credentialOrInvocationTested: false,
      note: bedrockEnabled
        ? "Enabled in configuration; this read-only diagnostics request does not invoke the model. Run npm run test:bedrock to test a real request."
        : "Disabled in configuration. This is expected while AWS quota/access is pending.",
    },
    mcp: {
      endpoint: "/api/mcp",
      transport: "Streamable HTTP",
      sharedTokenConfigured: mcpTokenConfigured,
      remoteAlexaPlusReady: false,
      note: "A shared bearer token is a development gate, not Alexa+ account linking. Alexa+ remote onboarding requires the documented OAuth 2.1 + PKCE/resource-metadata flow and an HTTPS endpoint.",
    },
  };

  if (!config) {
    return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const supabase = await createClient();
    if (!supabase) return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      base.supabase.authStatus = "sign_in_required";
      return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });
    }

    base.supabase.authenticated = true;
    base.supabase.authStatus = "ok";
    const checks = await Promise.all(tableNames.map(async (table) => {
      try {
        // Select only a non-sensitive sentinel column and return only the status to the caller.
        const { error: tableError } = await supabase.from(table).select("id").limit(1);
        if (!tableError) return [table, { status: "ok" as const }] as const;
        const message = tableError.message.toLowerCase();
        const hint = /relation|schema cache|does not exist|could not find the table/.test(message)
          ? "Run the latest CampusMate schema/migrations for this table."
          : /permission|policy|row-level security|rls/.test(message)
            ? "Check the table's grants and row-level security policies."
            : "Check this table's schema and authenticated-user permissions.";
        return [table, { status: "error" as const, hint }] as const;
      } catch {
        return [table, { status: "error" as const, hint: "The read-only table check failed. Check Supabase connectivity and schema." }] as const;
      }
    }));
    base.supabase.tables = Object.fromEntries(checks) as Record<TableName, TableCheck>;
  } catch {
    base.supabase.authStatus = "check_failed";
  }

  return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });
}
