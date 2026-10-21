import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { buildBedrockBrief, isBedrockEnabled } from "@/lib/bedrock/daily-brief";
import { buildRuleBasedBrief, sanitizePlannerTasks } from "@/lib/planning/engine";
import type { PlannerTask, PlannerPriority } from "@/lib/planning/types";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const plannerTaskInputSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().min(1).max(180),
  detail: z.string().max(300).optional(),
  time: z.string().max(40).optional(),
  duration: z.string().max(40).optional(),
  priority: z.enum(["Today", "Soon", "Whenever"]).optional(),
  done: z.boolean().optional(),
  kind: z.enum(["study", "class", "life"]).optional(),
});
const plannerTaskArraySchema = z.array(plannerTaskInputSchema).max(40).optional();
type Workspace = { tasks: PlannerTask[]; source: string };

const seedTasks: PlannerTask[] = [
  { id: "1", title: "Finish DSA assignment", detail: "Data Structures · BSTs", time: "10:30 AM", duration: "35 min", priority: "Today", done: false, kind: "study" },
  { id: "2", title: "Physics lecture", detail: "Block C · Room 204", time: "11:30 AM", duration: "1 hr", priority: "Today", done: false, kind: "class" },
  { id: "3", title: "Submit lab observation", detail: "Applied Physics · Due today", time: "1:00 PM", duration: "25 min", priority: "Today", done: false, kind: "study" },
  { id: "4", title: "Lunch away from my desk", detail: "A proper break, not another tab", time: "1:30 PM", duration: "40 min", priority: "Whenever", done: false, kind: "life" },
];
type CampusMateGlobal = typeof globalThis & { __campusMateMcpDemoTasks?: PlannerTask[] };
const globalForCampusMate = globalThis as CampusMateGlobal;
if (!globalForCampusMate.__campusMateMcpDemoTasks) globalForCampusMate.__campusMateMcpDemoTasks = seedTasks.map((task) => ({ ...task }));

function demoTasks(): PlannerTask[] {
  return globalForCampusMate.__campusMateMcpDemoTasks ?? seedTasks.map((task) => ({ ...task }));
}

function fromDatabaseRow(row: Record<string, unknown>): PlannerTask {
  const id = String(row.id ?? "");
  return {
    id: /^\d+$/.test(id) ? Number(id) : id,
    title: String(row.title ?? ""),
    detail: String(row.detail ?? ""),
    time: String(row.scheduled_time ?? "Not scheduled"),
    duration: String(row.duration ?? "30 min"),
    priority: row.priority === "Today" || row.priority === "Soon" || row.priority === "Whenever" ? row.priority : "Soon",
    done: row.is_done === true,
    kind: row.kind === "class" || row.kind === "life" || row.kind === "study" ? row.kind : "study",
  };
}

async function readAuthenticatedWorkspace(): Promise<{ tasks: PlannerTask[]; supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>; userId: string } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return null;
    const { data, error } = await supabase.from("tasks")
      .select("id,title,detail,scheduled_time,duration,priority,is_done,kind")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: true });
    if (error) return null;
    return {
      tasks: (data ?? []).map((row) => fromDatabaseRow(row as Record<string, unknown>)),
      supabase,
      userId: userData.user.id,
    };
  } catch {
    // The MCP demo still works against its isolated sample workspace when cloud auth is absent.
    return null;
  }
}

async function getWorkspace(providedTasks?: unknown): Promise<Workspace> {
  if (providedTasks !== undefined) {
    return { tasks: sanitizePlannerTasks(providedTasks), source: "current planner snapshot supplied by the caller" };
  }
  const authenticated = await readAuthenticatedWorkspace();
  if (authenticated) return { tasks: authenticated.tasks, source: "signed-in Supabase account" };
  return { tasks: demoTasks().map((task) => ({ ...task })), source: "local MCP demo workspace (in memory)" };
}

function result(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function timeValue(value: string): number {
  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

function buildServer() {
  const server = new McpServer({ name: "campusmate-ai", version: "33.0.0" }, { capabilities: { tools: {} } });

  server.registerTool("get_today_overview", {
    description: "Summarise open tasks, completed items, today-priority items, and CampusMate's best starting point. Optionally pass the task snapshot currently visible in the app.",
    inputSchema: z.object({ tasks: plannerTaskArraySchema }),
  }, async ({ tasks: suppliedTasks }) => {
    const workspace = await getWorkspace(suppliedTasks);
    const open = workspace.tasks.filter((task) => !task.done);
    const complete = workspace.tasks.length - open.length;
    const todayCount = open.filter((task) => task.priority === "Today").length;
    const brief = buildRuleBasedBrief(workspace.tasks);
    return result({
      source: workspace.source,
      totalTasks: workspace.tasks.length,
      openTasks: open.length,
      completedTasks: complete,
      priorityToday: todayCount,
      nextBestMove: brief.priorityTitle,
      recommendationReason: brief.reason,
      note: "This is a planning snapshot, not a calendar-provider feed.",
    });
  });

  server.registerTool("list_tasks", {
    description: "List a student's open, completed, or all planner tasks. If a tasks array is passed, inspect that snapshot; otherwise use the signed-in Supabase workspace or the local MCP demo workspace.",
    inputSchema: z.object({
      tasks: plannerTaskArraySchema,
      status: z.enum(["open", "done", "all"]).optional(),
      kind: z.enum(["study", "class", "life"]).optional(),
    }),
  }, async ({ tasks: suppliedTasks, status = "open", kind }) => {
    const workspace = await getWorkspace(suppliedTasks);
    let selected = workspace.tasks;
    if (status === "open") selected = selected.filter((task) => !task.done);
    else if (status === "done") selected = selected.filter((task) => task.done);
    if (kind) selected = selected.filter((task) => task.kind === kind);
    return result({ source: workspace.source, status, count: selected.length, tasks: selected });
  });

  server.registerTool("get_schedule", {
    description: "Return the scheduled planner items in chronological order. This uses supplied planner data, the signed-in Supabase workspace, or the local demo workspace; it is not a live calendar integration.",
    inputSchema: z.object({ tasks: plannerTaskArraySchema }),
  }, async ({ tasks: suppliedTasks }) => {
    const workspace = await getWorkspace(suppliedTasks);
    const items = workspace.tasks
      .filter((task) => task.time && task.time !== "Not scheduled")
      .sort((a, b) => timeValue(a.time) - timeValue(b.time));
    return result({ source: workspace.source, count: items.length, items, note: "Times are the planner's saved labels; no external calendar was queried." });
  });

  server.registerTool("suggest_daily_plan", {
    description: "Create a feasible first-draft daily plan from task priorities and the student's context. Uses Amazon Bedrock when enabled and available, otherwise the deterministic CampusMate planning engine.",
    inputSchema: z.object({ tasks: plannerTaskArraySchema, context: z.string().max(600).optional() }),
  }, async ({ tasks: suppliedTasks, context = "" }) => {
    const workspace = await getWorkspace(suppliedTasks);
    const bedrock = await buildBedrockBrief(workspace.tasks, context);
    const brief = bedrock.brief ?? buildRuleBasedBrief(workspace.tasks, context);
    return result({
      source: workspace.source,
      provider: bedrock.status === "ready" ? "Amazon Bedrock" : "CampusMate rules-based planner",
      bedrockStatus: bedrock.status,
      brief,
      requiresStudentApproval: true,
      note: "This tool proposes a plan only. It does not silently change the student's schedule.",
    });
  });

  server.registerTool("update_task", {
    description: "Update a task's completion state and/or priority. Always call once with confirmed=false to preview; call again with confirmed=true only after the student approves. Signed-in web sessions update the authenticated user's Supabase row; otherwise this affects the in-memory demo workspace only.",
    inputSchema: z.object({
      taskId: z.string().min(1).max(80),
      done: z.boolean().optional(),
      priority: z.enum(["Today", "Soon", "Whenever"]).optional(),
      confirmed: z.boolean().optional(),
    }),
  }, async ({ taskId, done, priority, confirmed = false }) => {
    if (done === undefined && priority === undefined) {
      return result({ ok: false, error: "Provide either done or priority so CampusMate knows what to change." });
    }
    const authenticated = await readAuthenticatedWorkspace();
    const currentTasks = authenticated ? authenticated.tasks : demoTasks();
    const current = currentTasks.find((task) => String(task.id) === taskId);
    if (!current) return result({ ok: false, error: "Task not found in the active workspace.", availableTaskIds: currentTasks.map((task) => String(task.id)) });

    const update: { done?: boolean; priority?: PlannerPriority } = {};
    if (done !== undefined) update.done = done;
    if (priority !== undefined) update.priority = priority;
    const preview = { ...current, ...update };
    if (!confirmed) {
      return result({ ok: true, requiresConfirmation: true, before: current, proposed: preview, note: "No change has been saved. Ask the student to approve this exact update first." });
    }

    if (authenticated) {
      const databaseUpdate: { is_done?: boolean; priority?: PlannerPriority; updated_at: string } = { updated_at: new Date().toISOString() };
      if (done !== undefined) databaseUpdate.is_done = done;
      if (priority !== undefined) databaseUpdate.priority = priority;
      const { data, error } = await authenticated.supabase.from("tasks")
        .update(databaseUpdate)
        .eq("user_id", authenticated.userId)
        .eq("id", taskId)
        .select("id,title,detail,scheduled_time,duration,priority,is_done,kind")
        .single();
      if (error || !data) return result({ ok: false, error: "The task was not saved. Check that the task belongs to the signed-in account." });
      return result({ ok: true, persistence: "Supabase", task: fromDatabaseRow(data as Record<string, unknown>), note: "Approved update saved to the authenticated user's task row." });
    }

    const store = demoTasks();
    const index = store.findIndex((task) => String(task.id) === taskId);
    if (index < 0) return result({ ok: false, error: "Task not found in the demo workspace." });
    store[index] = preview;
    globalForCampusMate.__campusMateMcpDemoTasks = store;
    return result({ ok: true, persistence: "in-memory demo only", task: store[index], note: "This local demo update lasts only while the server process keeps its memory. Sign in and configure Supabase for persistent user-owned tasks." });
  });

  return server;
}

const mcpHandler = createMcpHandler(buildServer);

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function allowedHostnames(): string[] {
  const localHosts = process.env.NODE_ENV === "development" ? ["localhost", "127.0.0.1", "::1"] : [];
  const hosts = [...localHosts, ...csv(process.env.MCP_ALLOWED_HOSTS)];
  if (process.env.VERCEL_URL) hosts.push(process.env.VERCEL_URL.split(":")[0]);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try { hosts.push(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname); } catch { /* ignore malformed optional URL */ }
  }
  return [...new Set(hosts.map((host) => host.toLowerCase()))];
}

function allowedOriginHostnames(): string[] {
  const localOrigins = process.env.NODE_ENV === "development" ? ["localhost", "127.0.0.1", "::1"] : [];
  const origins = [...localOrigins, ...csv(process.env.MCP_ALLOWED_ORIGINS)];
  if (process.env.VERCEL_URL) origins.push(process.env.VERCEL_URL.split(":")[0]);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try { origins.push(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname); } catch { /* ignore malformed optional URL */ }
  }
  return [...new Set(origins.map((origin) => origin.toLowerCase()))];
}

function constantTimeTokenMatch(request: Request, expected: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const presented = Buffer.from(match[1]);
  const configured = Buffer.from(expected);
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

async function dispatch(request: Request): Promise<Response> {
  const hostRejected = hostHeaderValidationResponse(request, allowedHostnames());
  if (hostRejected) return hostRejected;
  const originRejected = originValidationResponse(request, allowedOriginHostnames());
  if (originRejected) return originRejected;

  const token = process.env.CAMPUSMATE_MCP_TOKEN;
  if (process.env.NODE_ENV === "production" && !token) {
    return Response.json({ error: "MCP endpoint is disabled until CAMPUSMATE_MCP_TOKEN and allowed hosts/origins are configured." }, { status: 503 });
  }
  if (token && !constantTimeTokenMatch(request, token)) {
    return Response.json({ error: "Unauthorized MCP request. Supply the configured bearer token." }, { status: 401 });
  }
  return mcpHandler.fetch(request);
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
