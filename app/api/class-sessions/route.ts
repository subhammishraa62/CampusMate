import { NextResponse } from "next/server";
import { cleanText, isErrorResponse, jsonNoStore, readJsonObject, requireUser } from "@/lib/supabase/route-auth";

export const dynamic = "force-dynamic";
const selectFields = "id,course_id,title,location,starts_at,ends_at,recurrence_rule,notes,created_at,updated_at";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("class_sessions").select(selectFields).eq("user_id", auth.user.id).order("starts_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load class sessions. Apply the current Supabase schema." }, { status: 500 });
  return jsonNoStore({ sessions: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const title = cleanText(body.title, 180);
  const startsAt = typeof body.starts_at === "string" ? body.starts_at : "";
  const endsAt = typeof body.ends_at === "string" ? body.ends_at : "";
  if (!title) return NextResponse.json({ error: "Class title is required." }, { status: 400 });
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) {
    return NextResponse.json({ error: "Provide valid starts_at and ends_at timestamps; the end must be after the start." }, { status: 400 });
  }
  let courseId: string | null = null;
  if (typeof body.course_id === "string" && body.course_id.trim()) {
    courseId = body.course_id.trim();
    const { data: course, error: courseError } = await auth.supabase.from("courses").select("id").eq("id", courseId).eq("user_id", auth.user.id).maybeSingle();
    if (courseError) return NextResponse.json({ error: "Could not validate the selected course." }, { status: 500 });
    if (!course) return NextResponse.json({ error: "The selected course does not belong to this account." }, { status: 403 });
  }
  const { data, error } = await auth.supabase.from("class_sessions").insert({
    user_id: auth.user.id, course_id: courseId, title, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(),
    location: cleanText(body.location, 120) || null, recurrence_rule: cleanText(body.recurrence_rule, 160) || null, notes: cleanText(body.notes, 1000) || null,
  }).select(selectFields).single();
  if (error || !data) return NextResponse.json({ error: "Class session could not be saved." }, { status: 500 });
  return jsonNoStore({ session: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const id = cleanText(body.id, 80);
  if (!id) return NextResponse.json({ error: "Class session id is required." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = cleanText(body.title, 180);
  if (typeof body.location === "string" || body.location === null) patch.location = cleanText(body.location, 120) || null;
  if (typeof body.notes === "string" || body.notes === null) patch.notes = cleanText(body.notes, 1000) || null;
  if (typeof body.recurrence_rule === "string" || body.recurrence_rule === null) patch.recurrence_rule = cleanText(body.recurrence_rule, 160) || null;
  for (const field of ["starts_at", "ends_at"] as const) {
    if (typeof body[field] === "string") {
      if (!Number.isFinite(Date.parse(body[field] as string))) return NextResponse.json({ error: `${field} must be a valid timestamp.` }, { status: 400 });
      patch[field] = new Date(body[field] as string).toISOString();
    }
  }
  if ("course_id" in body) {
    const courseId = typeof body.course_id === "string" && body.course_id.trim() ? body.course_id.trim() : null;
    if (courseId) {
      const { data: course } = await auth.supabase.from("courses").select("id").eq("id", courseId).eq("user_id", auth.user.id).maybeSingle();
      if (!course) return NextResponse.json({ error: "The selected course does not belong to this account." }, { status: 403 });
    }
    patch.course_id = courseId;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Provide at least one class-session field to update." }, { status: 400 });
  if (patch.title === "") return NextResponse.json({ error: "Class title cannot be empty." }, { status: 400 });
  const { data: current } = await auth.supabase.from("class_sessions").select("starts_at,ends_at").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Class session not found." }, { status: 404 });
  const start = String(patch.starts_at ?? current.starts_at);
  const end = String(patch.ends_at ?? current.ends_at);
  if (Date.parse(end) <= Date.parse(start)) return NextResponse.json({ error: "The end must be after the start." }, { status: 400 });
  const { data, error } = await auth.supabase.from("class_sessions").update(patch).eq("id", id).eq("user_id", auth.user.id).select(selectFields).single();
  if (error || !data) return NextResponse.json({ error: "Class session could not be updated." }, { status: 500 });
  return jsonNoStore({ session: data });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Pass the class session id as ?id=..." }, { status: 400 });
  const { data, error } = await auth.supabase.from("class_sessions").delete().eq("id", id).eq("user_id", auth.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Class session could not be deleted." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Class session not found." }, { status: 404 });
  return jsonNoStore({ ok: true, id: data.id });
}
