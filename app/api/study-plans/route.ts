import { NextResponse } from "next/server";
import { cleanText, isErrorResponse, jsonNoStore, readJsonObject, requireUser } from "@/lib/supabase/route-auth";

export const dynamic = "force-dynamic";
const fields = "id,plan_date,title,summary,status,source,plan_data,created_at,updated_at";
const statuses = ["draft", "accepted", "archived"] as const;

function isValidPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  let query = auth.supabase.from("study_plans").select(fields).eq("user_id", auth.user.id).order("plan_date", { ascending: false }).limit(50);
  if (date) {
    if (!isValidPlanDate(date)) return NextResponse.json({ error: "date must be a real calendar date in YYYY-MM-DD format." }, { status: 400 });
    query = query.eq("plan_date", date);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load study plans. Apply the current Supabase schema." }, { status: 500 });
  return jsonNoStore({ plans: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const title = cleanText(body.title, 140) || "Daily plan";
  const summary = cleanText(body.summary, 2000);
  const planDate = typeof body.plan_date === "string" ? body.plan_date : new Date().toISOString().slice(0, 10);
  if (!isValidPlanDate(planDate)) {
    return NextResponse.json({ error: "plan_date must be a real calendar date in YYYY-MM-DD format." }, { status: 400 });
  }
  const status = statuses.includes(body.status as typeof statuses[number]) ? body.status as typeof statuses[number] : "draft";
  const source = body.source === "ai" ? "ai" : "rules";
  const planData = body.plan_data ?? [];
  if (!Array.isArray(planData) && (!planData || typeof planData !== "object")) return NextResponse.json({ error: "plan_data must be an array or object." }, { status: 400 });
  if (JSON.stringify(planData).length > 100_000) return NextResponse.json({ error: "Plan data is too large (100 KB maximum)." }, { status: 413 });
  const { data, error } = await auth.supabase.from("study_plans").insert({
    user_id: auth.user.id, plan_date: planDate, title, summary, status, source, plan_data: planData,
  }).select(fields).single();
  if (error || !data) return NextResponse.json({ error: "Study plan could not be saved." }, { status: 500 });
  return jsonNoStore({ plan: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await readJsonObject(request);
  if (isErrorResponse(body)) return body;
  const id = cleanText(body.id, 80);
  if (!id) return NextResponse.json({ error: "Study-plan id is required." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = cleanText(body.title, 140);
    if (!title) return NextResponse.json({ error: "Plan title cannot be empty." }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.summary === "string") patch.summary = cleanText(body.summary, 2000);
  if (typeof body.status === "string") {
    if (!statuses.includes(body.status as typeof statuses[number])) return NextResponse.json({ error: "status must be draft, accepted, or archived." }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body.source === "string") {
    if (body.source !== "ai" && body.source !== "rules") return NextResponse.json({ error: "source must be ai or rules." }, { status: 400 });
    patch.source = body.source;
  }
  if (typeof body.plan_date === "string") {
    if (!isValidPlanDate(body.plan_date)) return NextResponse.json({ error: "plan_date must be a real calendar date in YYYY-MM-DD format." }, { status: 400 });
    patch.plan_date = body.plan_date;
  }
  if ("plan_data" in body) {
    if (!Array.isArray(body.plan_data) && (!body.plan_data || typeof body.plan_data !== "object")) return NextResponse.json({ error: "plan_data must be an array or object." }, { status: 400 });
    if (JSON.stringify(body.plan_data).length > 100_000) return NextResponse.json({ error: "Plan data is too large (100 KB maximum)." }, { status: 413 });
    patch.plan_data = body.plan_data;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Provide at least one plan field to update." }, { status: 400 });
  const { data, error } = await auth.supabase.from("study_plans").update(patch).eq("id", id).eq("user_id", auth.user.id).select(fields).maybeSingle();
  if (error) return NextResponse.json({ error: "Study plan could not be updated." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Study plan not found." }, { status: 404 });
  return jsonNoStore({ plan: data });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Pass the study-plan id as ?id=..." }, { status: 400 });
  const { data, error } = await auth.supabase.from("study_plans").delete().eq("id", id).eq("user_id", auth.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Study plan could not be deleted." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Study plan not found." }, { status: 404 });
  return jsonNoStore({ ok: true, id: data.id });
}
