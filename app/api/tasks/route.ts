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
    priority: row.priority === "Low" || row.priority === "Medium" || row.priority === "High" ? row.priority : row.priority === "Today" ? "High" : row.priority === "Whenever" ? "Low" : "Medium",
    scheduledDate: typeof row.scheduled_date === "string" ? row.scheduled_date : "",
    startTime: typeof row.start_time === "string" ? row.start_time : "",
    endTime: typeof row.end_time === "string" ? row.end_time : "",
    deadlineDate: typeof row.deadline_date === "string" ? row.deadline_date : "",
    deadlineTime: typeof row.deadline_time === "string" ? row.deadline_time : "",
    reminderMinutes: typeof row.reminder_minutes === "number" ? row.reminder_minutes : null,
    courseId: typeof row.course_id === "string" ? row.course_id : null,
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
  const { data, error } = await auth.supabase.from("tasks").select("id,title,detail,scheduled_time,duration,priority,is_done,kind,scheduled_date,start_time,end_time,deadline_date,deadline_time,reminder_minutes,course_id").eq("user_id", auth.user.id).order("created_at", { ascending: true });
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
    priority: PlannerPriority; is_done: boolean; kind: PlannerKind; scheduled_date: string | null; start_time: string | null; end_time: string | null; deadline_date: string | null; deadline_time: string | null; reminder_minutes: number | null; course_id: string | null; updated_at: string;
  }> = [];
  for (const [index, input] of inputTasks.entries()) {
    if (!input || typeof input !== "object") return NextResponse.json({ error: `Task ${index + 1} is invalid.` }, { status: 400 });
    const task = input as Record<string, unknown>;
    const id = String(task.id ?? "").slice(0, 80);
    const title = typeof task.title === "string" ? task.title.trim().slice(0, 180) : "";
    if (!id || !title) return NextResponse.json({ error: `Task ${index + 1} needs an id and title.` }, { status: 400 });
    const priority: PlannerPriority = task.priority === "Low" || task.priority === "Medium" || task.priority === "High" ? task.priority : task.priority === "Today" ? "High" : task.priority === "Whenever" ? "Low" : "Medium";
    const cleanDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    const cleanTime = (value: unknown) => typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
    const reminderRaw = task.reminderMinutes;
    const reminder = typeof reminderRaw === "number" && [0, 15, 30, 60, 1440].includes(reminderRaw) ? reminderRaw : null;
    const kind: PlannerKind = task.kind === "class" || task.kind === "life" || task.kind === "study" ? task.kind : "study";
    const courseId = typeof task.courseId === "string" && task.courseId.trim() ? task.courseId.trim().slice(0, 80) : null;
    if (courseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
      return NextResponse.json({ error: `Task ${index + 1} has an invalid course id. Choose a course saved to this account.` }, { status: 400 });
    }
    tasks.push({
      id, user_id: auth.user.id, title,
      detail: typeof task.detail === "string" ? task.detail.trim().slice(0, 300) : "",
      scheduled_time: typeof task.time === "string" ? task.time.trim().slice(0, 40) : "Not scheduled",
      duration: typeof task.duration === "string" ? task.duration.trim().slice(0, 40) : "30 min",
      priority, is_done: task.done === true, kind,
      scheduled_date: cleanDate(task.scheduledDate), start_time: cleanTime(task.startTime), end_time: cleanTime(task.endTime),
      deadline_date: cleanDate(task.deadlineDate), deadline_time: cleanTime(task.deadlineTime), reminder_minutes: reminder, course_id: courseId,
      updated_at: new Date().toISOString(),
    });
  }

  const linkedCourseIds = [...new Set(tasks.map((task) => task.course_id).filter((id): id is string => Boolean(id)))];
  if (linkedCourseIds.length) {
    const { data: ownedCourses, error: courseError } = await auth.supabase.from("courses").select("id").eq("user_id", auth.user.id).in("id", linkedCourseIds);
    if (courseError) return NextResponse.json({ error: "Could not verify linked courses. Apply the task-course migration and try again." }, { status: 500 });
    const ownedIds = new Set((ownedCourses ?? []).map((course) => String(course.id)));
    const missingCourse = linkedCourseIds.find((id) => !ownedIds.has(id));
    if (missingCourse) return NextResponse.json({ error: "A task links to a course that does not belong to this account. Choose one of your saved courses." }, { status: 403 });
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
