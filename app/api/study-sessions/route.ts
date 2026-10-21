import { NextResponse } from "next/server";
import { cleanText, isErrorResponse, jsonNoStore, readJsonObject, requireUser } from "@/lib/supabase/route-auth";

export const dynamic = "force-dynamic";
const fields = "id,task_id,course_id,title,started_at,ended_at,duration_seconds,status,notes,created_at,updated_at";
const statuses = ["running", "completed", "cancelled"] as const;

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50) || 50));
  const { data, error } = await auth.supabase.from("study_sessions").select(fields).eq("user_id", auth.user.id)
    .order("started_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: "Could not load study sessions. Apply the current Supabase schema." }, { status: 500 });
  return jsonNoStore({ sessions: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const title = cleanText(body.title, 180);
  if (!title) return NextResponse.json({ error: "A study-session title is required." }, { status: 400 });
  const startedAt = typeof body.started_at === "string" ? body.started_at : new Date().toISOString();
  if (!Number.isFinite(Date.parse(startedAt))) return NextResponse.json({ error: "started_at must be a valid timestamp." }, { status: 400 });
  let courseId: string | null = null;
  if (typeof body.course_id === "string" && body.course_id.trim()) {
    courseId = body.course_id.trim();
    const { data: course } = await auth.supabase.from("courses").select("id").eq("id", courseId).eq("user_id", auth.user.id).maybeSingle();
    if (!course) return NextResponse.json({ error: "The selected course does not belong to this account." }, { status: 403 });
  }
  const taskId = typeof body.task_id === "string" ? body.task_id.trim().slice(0, 80) || null : null;
  if (taskId) {
    const { data: task, error: taskError } = await auth.supabase.from("tasks").select("id").eq("id", taskId).eq("user_id", auth.user.id).maybeSingle();
    if (taskError) return NextResponse.json({ error: "Could not validate the selected task." }, { status: 500 });
    if (!task) return NextResponse.json({ error: "The selected task does not belong to this account." }, { status: 403 });
  }
  const { data: existingRunning, error: runningError } = await auth.supabase.from("study_sessions").select("id")
    .eq("user_id", auth.user.id).eq("status", "running").limit(1).maybeSingle();
  if (runningError) return NextResponse.json({ error: "Could not verify whether another focus session is running." }, { status: 500 });
  if (existingRunning) return NextResponse.json({ error: "Finish or cancel your current focus session before starting another." }, { status: 409 });
  const { data, error } = await auth.supabase.from("study_sessions").insert({
    user_id: auth.user.id, title, course_id: courseId, task_id: taskId,
    started_at: new Date(startedAt).toISOString(), status: "running", notes: cleanText(body.notes, 1000) || null,
  }).select(fields).single();
  if (error || !data) return NextResponse.json({ error: "Study session could not be started." }, { status: 500 });
  return jsonNoStore({ session: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const id = cleanText(body.id, 80);
  if (!id) return NextResponse.json({ error: "Study-session id is required." }, { status: 400 });
  const { data: current, error: currentError } = await auth.supabase.from("study_sessions").select(fields).eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (currentError) return NextResponse.json({ error: "Could not read the study session." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Study session not found." }, { status: 404 });
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = cleanText(body.title, 180);
    if (!title) return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.notes === "string" || body.notes === null) patch.notes = cleanText(body.notes, 1000) || null;
  if (typeof body.status === "string") {
    if (!statuses.includes(body.status as typeof statuses[number])) return NextResponse.json({ error: "status must be running, completed, or cancelled." }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body.ended_at === "string") {
    if (!Number.isFinite(Date.parse(body.ended_at))) return NextResponse.json({ error: "ended_at must be a valid timestamp." }, { status: 400 });
    const endedAt = new Date(body.ended_at).toISOString();
    const seconds = Math.floor((Date.parse(endedAt) - Date.parse(current.started_at)) / 1000);
    if (seconds < 0) return NextResponse.json({ error: "ended_at cannot be before started_at." }, { status: 400 });
    patch.ended_at = endedAt;
    patch.duration_seconds = seconds;
    if (!("status" in patch)) patch.status = "completed";
  } else if (patch.status === "completed" || patch.status === "cancelled") {
    const endedAt = new Date().toISOString();
    const seconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(current.started_at)) / 1000));
    patch.ended_at = endedAt;
    patch.duration_seconds = seconds;
  } else if (patch.status === "running" && current.ended_at) {
    patch.ended_at = null;
    patch.duration_seconds = 0;
  }
  if (patch.status === "running" && patch.ended_at) return NextResponse.json({ error: "A running session cannot have ended_at set." }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Provide a field to update, such as status or ended_at." }, { status: 400 });
  const { data, error } = await auth.supabase.from("study_sessions").update(patch).eq("id", id).eq("user_id", auth.user.id).select(fields).single();
  if (error || !data) return NextResponse.json({ error: "Study session could not be updated." }, { status: 500 });
  return jsonNoStore({ session: data });
}
