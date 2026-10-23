import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function main() {
  const endpoint = process.env.CAMPUSMATE_MCP_URL || "http://localhost:3000/api/mcp";
  const headers = new Headers();
  if (process.env.CAMPUSMATE_MCP_TOKEN) headers.set("Authorization", `Bearer ${process.env.CAMPUSMATE_MCP_TOKEN}`);

  const client = new Client(
  { name: "campusmate-mcp-smoke-test", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }
);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } });
  let connected = false;
  try {
    await client.connect(transport);
    connected = true;
    const result = await client.listTools();
    const toolNames = result.tools.map((tool) => tool.name);
    const required = ["get_today_overview", "list_tasks", "get_schedule", "suggest_daily_plan", "update_task"];
    const missing = required.filter((name) => !toolNames.includes(name));
    if (missing.length) throw new Error(`MCP connected, but required tools are missing: ${missing.join(", ")}`);
    const overview = await client.callTool({ name: "get_today_overview", arguments: {} });
    const text = (overview.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (!text) throw new Error("MCP connected, but get_today_overview returned no text content.");
    console.log("CampusMate MCP smoke test: PASS");
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Protocol era: ${client.getProtocolEra?.() ?? "negotiated"}`);
    console.log(`Tools discovered: ${toolNames.join(", ")}`);
    console.log("Sample tool call: get_today_overview succeeded.");
  } catch (error) {
    console.error("CampusMate MCP smoke test: FAIL");
    console.error(error instanceof Error ? error.message : error);
    console.error("Ensure npm run dev is running, the MCP endpoint is configured, and any CAMPUSMATE_MCP_TOKEN matches.");
    process.exitCode = 1;
  } finally {
    if (connected) { try { await transport.terminateSession(); } catch { /* stateless transport may not issue a session */ } }
    try { await client.close(); } catch { /* already closed */ }
  }
}

void main();
