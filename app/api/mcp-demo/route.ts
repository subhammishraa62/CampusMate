import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { NextRequest, NextResponse } from "next/server";
import { sanitizePlannerTasks } from "@/lib/planning/engine";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateBuckets = new Map<string, { startedAt: number; count: number }>();
function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const prior = rateBuckets.get(key);
  if (rateBuckets.size > 1_000) {
    for (const [bucketKey, bucket] of rateBuckets) if (now - bucket.startedAt > 60_000) rateBuckets.delete(bucketKey);
  }
  if (!prior || now - prior.startedAt >= 60_000) { rateBuckets.set(key, { startedAt: now, count: 1 }); return true; }
  if (prior.count >= 8) return false;
  prior.count += 1;
  return true;
}

function extractToolJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("MCP tool returned an empty response.");
  const record = value as Record<string, unknown>;
  if (record.isError === true) throw new Error("An MCP tool returned an error.");
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .filter((item): item is { type: string; text: string } => !!item && typeof item === "object" && (item as Record<string, unknown>).type === "text" && typeof (item as Record<string, unknown>).text === "string")
    .map((item) => item.text)
    .join("\n");
  if (!text) throw new Error("MCP tool returned no readable text content.");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("MCP tool response was not valid JSON text.");
  }
}

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!withinRateLimit(key)) return NextResponse.json({ error: "MCP demo rate limit reached. Wait a minute and try again." }, { status: 429 });

  // Do not make this Bedrock-backed demo route an unauthenticated public model proxy in production.
  if (process.env.NODE_ENV === "production") {
    if (!getSupabaseConfig()) return NextResponse.json({ error: "Configure Supabase authentication before enabling the production MCP demo." }, { status: 503 });
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
      if (error || !data.user) return NextResponse.json({ error: "Sign in to run the production MCP demo." }, { status: 401 });
    } catch {
      return NextResponse.json({ error: "Could not verify the current account session." }, { status: 401 });
    }
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });

  const input = body as Record<string, unknown>;
  let tasks: ReturnType<typeof sanitizePlannerTasks>;
  try { tasks = sanitizePlannerTasks(input.tasks); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid task list." }, { status: 400 }); }
  const context = typeof input.context === "string" ? input.context.trim().slice(0, 600) : "";

  const mcpUrl = new URL("/api/mcp", request.url);
  const headers = new Headers();
  const token = process.env.CAMPUSMATE_MCP_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Forward the browser session only to this same-origin MCP endpoint so the MCP
  // tools can use the signed-in user's Supabase session when available.
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("Cookie", cookie);

  const transport = new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } });
  const client = new Client({ name: "campusmate-intelligence-brief-demo", version: "1.0.0" });
  let connected = false;
  try {
    await client.connect(transport);
    connected = true;
    const toolList = await client.listTools();
    const expectedTools = ["list_tasks", "get_today_overview", "suggest_daily_plan"];
    const availableTools = toolList.tools.map((tool) => tool.name);
    const missing = expectedTools.filter((name) => !availableTools.includes(name));
    if (missing.length) throw new Error(`MCP server is missing expected tools: ${missing.join(", ")}.`);

    const listResult = await client.callTool({
      name: "list_tasks",
      arguments: { tasks, status: "open" },
    });
    const listData = extractToolJson(listResult);
    const overviewResult = await client.callTool({
      name: "get_today_overview",
      arguments: { tasks },
    });
    const overview = extractToolJson(overviewResult);
    const planResult = await client.callTool({
      name: "suggest_daily_plan",
      arguments: { tasks, context },
    });
    const planData = extractToolJson(planResult);

    if (!planData.brief || typeof planData.brief !== "object") throw new Error("The MCP planning tool didn't return a usable brief.");
    return NextResponse.json({
      ok: true,
      protocol: String(client.getProtocolEra?.() ?? "negotiated"),
      server: client.getServerVersion(),
      tools: availableTools,
      calls: ["list_tasks", "get_today_overview", "suggest_daily_plan"],
      openTaskCount: typeof listData.count === "number" ? listData.count : null,
      overview,
      brief: planData.brief,
      provider: typeof planData.provider === "string" ? planData.provider : "CampusMate planning engine",
      bedrockStatus: typeof planData.bedrockStatus === "string" ? planData.bedrockStatus : "unknown",
      source: typeof planData.source === "string" ? planData.source : "unknown",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP handshake or tool call failed.";
    return NextResponse.json({ error: message, hint: "Check that the local MCP endpoint is reachable and, if configured, that CAMPUSMATE_MCP_TOKEN matches." }, { status: 502 });
  } finally {
    if (connected) {
      try { await transport.terminateSession(); } catch { /* stateless endpoint may not issue a session id */ }
    }
    try { await client.close(); } catch { /* already closed after a failed transport */ }
  }
}
