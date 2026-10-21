import { NextResponse } from "next/server";
import { cleanText, isErrorResponse, jsonNoStore, readJsonObject, requireUser } from "@/lib/supabase/route-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("courses")
    .select("id,title,course_code,instructor,color_token,created_at,updated_at")
    .eq("user_id", auth.user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load courses. Apply the current Supabase schema." }, { status: 500 });
  return jsonNoStore({ courses: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const title = cleanText(body.title, 140);
  if (!title) return NextResponse.json({ error: "Course title is required (max 140 characters)." }, { status: 400 });
  const course = {
    user_id: auth.user.id,
    title,
    course_code: cleanText(body.course_code, 32) || null,
    instructor: cleanText(body.instructor, 100) || null,
    color_token: cleanText(body.color_token, 32, "lavender") || "lavender",
  };
  const { data, error } = await auth.supabase.from("courses").insert(course)
    .select("id,title,course_code,instructor,color_token,created_at,updated_at").single();
  if (error || !data) return NextResponse.json({ error: "Course could not be saved. Check the database schema and permissions." }, { status: 500 });
  return jsonNoStore({ course: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const id = cleanText(body.id, 80);
  if (!id) return NextResponse.json({ error: "Course id is required." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = cleanText(body.title, 140);
  if (typeof body.course_code === "string" || body.course_code === null) patch.course_code = cleanText(body.course_code, 32) || null;
  if (typeof body.instructor === "string" || body.instructor === null) patch.instructor = cleanText(body.instructor, 100) || null;
  if (typeof body.color_token === "string") patch.color_token = cleanText(body.color_token, 32) || "lavender";
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Provide at least one course field to update." }, { status: 400 });
  if (patch.title === "") return NextResponse.json({ error: "Course title cannot be empty." }, { status: 400 });
  const { data, error } = await auth.supabase.from("courses").update(patch).eq("id", id).eq("user_id", auth.user.id)
    .select("id,title,course_code,instructor,color_token,created_at,updated_at").maybeSingle();
  if (error) return NextResponse.json({ error: "Course could not be updated." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Course not found." }, { status: 404 });
  return jsonNoStore({ course: data });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Pass the course id as ?id=..." }, { status: 400 });
  const { data, error } = await auth.supabase.from("courses").delete().eq("id", id).eq("user_id", auth.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Course could not be deleted." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Course not found." }, { status: 404 });
  return jsonNoStore({ ok: true, id: data.id });
}
