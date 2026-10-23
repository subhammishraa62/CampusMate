import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const selectedColumns = "id,display_name,college,course,branch,year_of_study,semester,bio,study_goal_hours,preferred_start,preferred_end,avatar_url";
function asProfile(row: Record<string, unknown>) {
  return {
    displayName: String(row.display_name ?? "Student"),
    college: String(row.college ?? ""),
    course: String(row.course ?? ""),
    branch: String(row.branch ?? ""),
    studyYear: row.year_of_study == null ? "" : String(row.year_of_study),
    semester: String(row.semester ?? ""),
    bio: String(row.bio ?? ""),
    studyGoalHours: String(row.study_goal_hours ?? 3),
    preferredStart: typeof row.preferred_start === "string" ? row.preferred_start.slice(0, 5) : "17:00",
    preferredEnd: typeof row.preferred_end === "string" ? row.preferred_end.slice(0, 5) : "21:00",
    avatarUrl: String(row.avatar_url ?? ""),
  };
}
async function getClient() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: NextResponse.json({ error: "Sign in to sync profile details across devices." }, { status: 401 }) } as const;
  return { supabase, user: data.user } as const;
}

export async function GET() {
  const auth = await getClient();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("profiles").select(selectedColumns).eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Profile fields are not ready. Apply supabase/migrations/20261023_profile_deadlines_priorities.sql and retry." }, { status: 503 });
  if (data) return NextResponse.json({ profile: asProfile(data as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
  const metadata = auth.user.user_metadata ?? {};
  return NextResponse.json({ profile: { displayName: String(metadata.display_name ?? metadata.full_name ?? auth.user.email?.split("@")[0] ?? "Student"), college: "", course: "", branch: "", studyYear: "", semester: "", bio: "", studyGoalHours: "3", preferredStart: "17:00", preferredEnd: "21:00", avatarUrl: "" } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await getClient();
  if ("error" in auth) return auth.error;
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Send profile details as a JSON object." }, { status: 400 });
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Send valid JSON." }, { status: 400 }); }

  const text = (value: unknown, max: number, fallback = "") => typeof value === "string" ? value.trim().slice(0, max) : fallback;
  const yearRaw = text(body.studyYear, 8);
  const year = /^\d{1,2}$/.test(yearRaw) ? Number(yearRaw) : null;
  const hoursRaw = Number(body.studyGoalHours);
  const studyGoal = Number.isFinite(hoursRaw) ? Math.min(16, Math.max(0.5, hoursRaw)) : 3;
  const time = (value: unknown, fallback: string) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
  const profile = {
    id: auth.user.id,
    display_name: text(body.displayName, 80, "Student") || "Student",
    college: text(body.college, 140),
    course: text(body.course, 100),
    branch: text(body.branch, 100),
    year_of_study: year,
    semester: text(body.semester, 40),
    bio: text(body.bio, 280),
    study_goal_hours: studyGoal,
    preferred_start: time(body.preferredStart, "17:00"),
    preferred_end: time(body.preferredEnd, "21:00"),
    avatar_url: text(body.avatarUrl, 2000),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await auth.supabase.from("profiles").upsert(profile, { onConflict: "id" }).select(selectedColumns).single();
  if (error) return NextResponse.json({ error: "Could not save the profile. Apply the provided Supabase profile migration and try again." }, { status: 503 });
  // Also update user metadata so the display name remains visible in account screens.
  await auth.supabase.auth.updateUser({ data: { display_name: profile.display_name, course: profile.course, study_year: year == null ? "" : String(year), avatar_url: profile.avatar_url } }).catch(() => undefined);
  return NextResponse.json({ profile: asProfile(data as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
}
