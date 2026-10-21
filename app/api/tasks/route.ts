import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlannerKind, PlannerPriority, PlannerTask } from "@/lib/planning/types";

export const dynamic = "force-dynamic";

function asClientTask(row: Record<string, unknown>): PlannerTask {
  const storedId = String(row.id ?? "");
  return {
    id: /^\d+$/.test(storedId) ? Number(storedId) : storedId,
    title: String(row.title ?? ""),
    detail: String(row.detail ?? ""),
    time: String(row.scheduled_time ?? "Not scheduled"),
    duration: String(row.duration ?? "30 min"),
    priority: row.priority === "Today" || row.priority === "Soon" || row.priority === "Whenever" ? row.priority : "Soon",
    done: row.is_done === true,
    kind: row.kind === "class" || row.kind === "life" || row.kind === "study" ? row.kind : "study",
  };
}

async function authenticatedClient() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured. Add the variables from .env.example to .env.local." }, { status: 503 }) };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: NextResponse.json({ error: "Sign in to enable cloud task sync." }, { status: 401 }) };
  return { supabase, user: data.user };
}

export async function GET() {
  const auth = await authenticatedClient();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("tasks").select("id,title,detail,scheduled_time,duration,priority,is_done,kind").eq("user_id", auth.user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load your tasks. Apply supabase/schema.sql and try again." }, { status: 500 });
  return NextResponse.json({ userId: auth.user.id, tasks: (data ?? []).map((row) => asClientTask(row as Record<string, unknown>)) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await authenticatedClient();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).tasks)) {
    return NextResponse.json({ error: "Expected a tasks array." }, { status: 400 });
  }
  const inputTasks = (body as { tasks: unknown[] }).tasks;
  if (inputTasks.length > 100) return NextResponse.json({ error: "A planner can sync up to 100 tasks." }, { status: 400 });

  const tasks: Array<{
    id: string; user_id: string; title: string; detail: string; scheduled_time: string; duration: string;
    priority: PlannerPriority; is_done: boolean; kind: PlannerKind; updated_at: string;
  }> = [];
  for (const [index, input] of inputTasks.entries()) {
    if (!input || typeof input !== "object") return NextResponse.json({ error: `Task ${index + 1} is invalid.` }, { status: 400 });
    const task = input as Record<string, unknown>;
    const id = String(task.id ?? "").slice(0, 80);
    const title = typeof task.title === "string" ? task.title.trim().slice(0, 180) : "";
    if (!id || !title) return NextResponse.json({ error: `Task ${index + 1} needs an id and title.` }, { status: 400 });
    const priority: PlannerPriority = task.priority === "Today" || task.priority === "Soon" || task.priority === "Whenever" ? task.priority : "Soon";
    const kind: PlannerKind = task.kind === "class" || task.kind === "life" || task.kind === "study" ? task.kind : "study";
    tasks.push({
      id, user_id: auth.user.id, title,
      detail: typeof task.detail === "string" ? task.detail.trim().slice(0, 300) : "",
      scheduled_time: typeof task.time === "string" ? task.time.trim().slice(0, 40) : "Not scheduled",
      duration: typeof task.duration === "string" ? task.duration.trim().slice(0, 40) : "30 min",
      priority, is_done: task.done === true, kind, updated_at: new Date().toISOString(),
    });
  }

  if (tasks.length) {
    const { error } = await auth.supabase.from("tasks").upsert(tasks, { onConflict: "user_id,id" });
    if (error) return NextResponse.json({ error: "Task sync failed. Check that supabase/schema.sql has been applied." }, { status: 500 });
  }

  const { data: existing, error: existingError } = await auth.supabase.from("tasks").select("id").eq("user_id", auth.user.id);
  if (existingError) return NextResponse.json({ error: "Tasks were saved, but sync verification failed." }, { status: 500 });
  const keep = new Set(tasks.map((task) => task.id));
  const staleIds = (existing ?? []).map((row) => String(row.id)).filter((id) => !keep.has(id));
  if (staleIds.length) {
    const { error } = await auth.supabase.from("tasks").delete().eq("user_id", auth.user.id).in("id", staleIds);
    if (error) return NextResponse.json({ error: "Tasks were saved, but old task cleanup failed. Try syncing again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: tasks.length }, { headers: { "Cache-Control": "no-store" } });
}
