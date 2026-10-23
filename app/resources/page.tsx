"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Course = {
  id: string;
  title: string;
  course_code: string | null;
  instructor: string | null;
  color_token: string;
  created_at: string;
  updated_at: string;
};
type ClassSession = {
  id: string;
  course_id: string | null;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
};
type FocusSession = {
  id: string;
  task_id: string | null;
  course_id: string | null;
  title: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  status: "running" | "completed" | "cancelled";
  notes: string | null;
};
type StudyPlan = {
  id: string;
  plan_date: string;
  title: string;
  summary: string;
  status: "draft" | "accepted" | "archived";
  source: "rules" | "ai";
  plan_data: unknown;
  created_at: string;
  updated_at?: string;
};
type Section = "courses" | "classes" | "focus" | "plans";
type ApiError = Error & { status?: number };
type AccessState = "unknown" | "ready" | "local" | "signin" | "setup" | "error";
type LocalResourceSnapshot = {
  version: 1;
  courses: Course[];
  classes: ClassSession[];
  focusSessions: FocusSession[];
  plans: StudyPlan[];
};
const LOCAL_RESOURCE_KEY = "campusmate-resources-v1";

function emptyLocalResourceSnapshot(): LocalResourceSnapshot {
  return { version: 1, courses: [], classes: [], focusSessions: [], plans: [] };
}
function readLocalResourceSnapshot(): LocalResourceSnapshot {
  if (typeof window === "undefined") return emptyLocalResourceSnapshot();
  try {
    const raw = window.localStorage.getItem(LOCAL_RESOURCE_KEY);
    if (!raw) return emptyLocalResourceSnapshot();
    const value = JSON.parse(raw) as Partial<LocalResourceSnapshot>;
    return {
      version: 1,
      courses: Array.isArray(value.courses) ? value.courses as Course[] : [],
      classes: Array.isArray(value.classes) ? value.classes as ClassSession[] : [],
      focusSessions: Array.isArray(value.focusSessions) ? value.focusSessions as FocusSession[] : [],
      plans: Array.isArray(value.plans) ? value.plans as StudyPlan[] : [],
    };
  } catch {
    return emptyLocalResourceSnapshot();
  }
}
function makeLocalId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `local-${prefix}-${random}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = {};
  try { body = await response.json(); } catch { /* handled below with a useful fallback */ }
  if (!response.ok) {
    const candidate = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
    const error = new Error(typeof candidate === "string" ? candidate : `Request failed (${response.status}).`) as ApiError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

function localDateTimeOffset(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function localDateTimeFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function durationLabel(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secondsPart = safe % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(secondsPart).padStart(2, "0")}s`;
}
function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const sectionCopy: Record<Section, { number: string; label: string; heading: string; description: string }> = {
  courses: { number: "01", label: "YOUR LEARNING MAP", heading: "Courses and classes, together.", description: "Manage your subjects and their lectures or labs in one place. Link every class to a course and keep the whole learning map connected." },
  classes: { number: "01", label: "YOUR LEARNING MAP", heading: "Courses and classes, together.", description: "Manage your subjects and their lectures or labs in one place. Link every class to a course and keep the whole learning map connected." },
  focus: { number: "02", label: "TIME WELL SPENT", heading: "Make focus visible.", description: "Start a study session, keep the timer honest, and finish when you are ready. Progress does not need to be perfect." },
  plans: { number: "03", label: "PLANS YOU CAN RETURN TO", heading: "Save a plan, not a promise.", description: "Keep useful study drafts, accept the ones that fit, and archive plans that no longer serve the day." },
};

export default function ResourcesPage() {
  const [section, setSection] = useState<Section>("courses");
  const [darkTone, setDarkTone] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessState, setAccessState] = useState<AccessState>("unknown");
  const [clock, setClock] = useState(0);
  const [todayStamp, setTodayStamp] = useState("TODAY");
  const backupInputRef = useRef<HTMLInputElement>(null);
  const classFormRef = useRef<HTMLFormElement>(null);
  const classTitleInputRef = useRef<HTMLInputElement>(null);

  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [instructor, setInstructor] = useState("");

  const [classSessionId, setClassSessionId] = useState<string | null>(null);
  const [classTitle, setClassTitle] = useState("");
  const [classCourseId, setClassCourseId] = useState("");
  const [classLocation, setClassLocation] = useState("");
  const [classStart, setClassStart] = useState("");
  const [classEnd, setClassEnd] = useState("");

  const [focusTitle, setFocusTitle] = useState("");
  const [focusCourseId, setFocusCourseId] = useState("");
  const [focusNotes, setFocusNotes] = useState("");

  const [planId, setPlanId] = useState<string | null>(null);
  const [planTitle, setPlanTitle] = useState("My study plan");
  const [planDateDraft, setPlanDateDraft] = useState("");
  const [planSummary, setPlanSummary] = useState("");
  const [planSteps, setPlanSteps] = useState("Review today's top priority\nTake a short break\nFinish one focused practice block");

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    if (accessState === "local") {
      const snapshot = readLocalResourceSnapshot();
      setCourses(snapshot.courses);
      setClasses(snapshot.classes);
      setFocusSessions(snapshot.focusSessions);
      setPlans(snapshot.plans);
      setLoading(false);
      return;
    }
    try {
      const [courseData, classData, focusData, planData] = await Promise.all([
        api<{ courses: Course[] }>("/api/courses"),
        api<{ sessions: ClassSession[] }>("/api/class-sessions"),
        api<{ sessions: FocusSession[] }>("/api/study-sessions?limit=50"),
        api<{ plans: StudyPlan[] }>("/api/study-plans"),
      ]);
      setCourses(courseData.courses ?? []);
      setClasses(classData.sessions ?? []);
      setFocusSessions(focusData.sessions ?? []);
      setPlans(planData.plans ?? []);
      setAccessState("ready");
    } catch (caught) {
      const issue = caught as ApiError;
      // Keep the workspace usable while Supabase is not configured, the student
      // is signed out, or cloud resources are temporarily unavailable. This is an
      // explicit browser-only mode: it never attempts to write local records to a
      // different signed-in account.
      const snapshot = readLocalResourceSnapshot();
      setCourses(snapshot.courses);
      setClasses(snapshot.classes);
      setFocusSessions(snapshot.focusSessions);
      setPlans(snapshot.plans);
      setAccessState("local");
      if (issue.status !== 401 && issue.status !== 503) {
        setNotice(`Cloud resources could not be loaded (${issue.message || "request failed"}). Working locally in this browser; cloud data has not been changed.`);
      }
    } finally {
      setLoading(false);
    }
  }, [accessState]);

  const canManageResources = accessState === "ready" || accessState === "local";

  function persistLocalSnapshot(snapshot: LocalResourceSnapshot) {
    try {
      window.localStorage.setItem(LOCAL_RESOURCE_KEY, JSON.stringify(snapshot));
    } catch {
      throw new Error("This browser could not save the local workspace. Check available storage, then try again.");
    }
    setCourses(snapshot.courses);
    setClasses(snapshot.classes);
    setFocusSessions(snapshot.focusSessions);
    setPlans(snapshot.plans);
    window.dispatchEvent(new Event("campusmate:resources-updated"));
  }

  async function resourceRequest<T>(url: string, init?: RequestInit): Promise<T> {
    if (accessState !== "local") return api<T>(url, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(url, window.location.origin);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const snapshot: LocalResourceSnapshot = { version: 1, courses: [...courses], classes: [...classes], focusSessions: [...focusSessions], plans: [...plans] };
    const now = new Date().toISOString();
    const response = <TResult,>(payload: TResult) => payload as unknown as T;

    if (parsedUrl.pathname === "/api/courses") {
      if (method === "POST") {
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 140) : "";
        if (!title) throw new Error("Add a course name before saving.");
        const course: Course = { id: makeLocalId("course"), title, course_code: typeof body.course_code === "string" ? body.course_code : null, instructor: typeof body.instructor === "string" ? body.instructor : null, color_token: "lavender", created_at: now, updated_at: now };
        persistLocalSnapshot({ ...snapshot, courses: [course, ...snapshot.courses] });
        return response({ course });
      }
      if (method === "PATCH") {
        const id = String(body.id ?? "");
        const index = snapshot.courses.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("Course not found in this browser workspace.");
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 140) : snapshot.courses[index].title;
        if (!title) throw new Error("Course name cannot be empty.");
        const course = { ...snapshot.courses[index], title, course_code: typeof body.course_code === "string" ? body.course_code || null : snapshot.courses[index].course_code, instructor: typeof body.instructor === "string" ? body.instructor || null : snapshot.courses[index].instructor, updated_at: now };
        snapshot.courses[index] = course;
        persistLocalSnapshot(snapshot);
        return response({ course });
      }
      if (method === "DELETE") {
        const id = parsedUrl.searchParams.get("id");
        const coursesNext = snapshot.courses.filter((item) => item.id !== id);
        if (coursesNext.length === snapshot.courses.length) throw new Error("Course not found in this browser workspace.");
        persistLocalSnapshot({ ...snapshot, courses: coursesNext, classes: snapshot.classes.map((item) => item.course_id === id ? { ...item, course_id: null } : item), focusSessions: snapshot.focusSessions.map((item) => item.course_id === id ? { ...item, course_id: null } : item) });
        return response({ ok: true, id });
      }
    }

    if (parsedUrl.pathname === "/api/class-sessions") {
      if (method === "POST") {
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
        const startsAt = typeof body.starts_at === "string" ? body.starts_at : "";
        const endsAt = typeof body.ends_at === "string" ? body.ends_at : "";
        if (!title) throw new Error("Give this class session a title.");
        if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("The class must have valid times and end after it starts.");
        const courseId = typeof body.course_id === "string" && body.course_id ? body.course_id : null;
        if (courseId && !snapshot.courses.some((item) => item.id === courseId)) throw new Error("Choose a course from this browser workspace.");
        const item: ClassSession = { id: makeLocalId("class"), course_id: courseId, title, location: typeof body.location === "string" ? body.location : null, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), notes: null };
        persistLocalSnapshot({ ...snapshot, classes: [item, ...snapshot.classes] });
        return response({ session: item });
      }
      if (method === "PATCH") {
        const id = String(body.id ?? "");
        const index = snapshot.classes.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("Class session not found in this browser workspace.");
        const current = snapshot.classes[index];
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : current.title;
        const startsAt = typeof body.starts_at === "string" ? body.starts_at : current.starts_at;
        const endsAt = typeof body.ends_at === "string" ? body.ends_at : current.ends_at;
        if (!title) throw new Error("Class title cannot be empty.");
        if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("The class must have valid times and end after it starts.");
        const courseId = "course_id" in body ? (typeof body.course_id === "string" && body.course_id ? body.course_id : null) : current.course_id;
        if (courseId && !snapshot.courses.some((item) => item.id === courseId)) throw new Error("Choose a course from this browser workspace.");
        const updated: ClassSession = { ...current, title, course_id: courseId, location: typeof body.location === "string" ? body.location : body.location === null ? null : current.location, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString() };
        snapshot.classes[index] = updated;
        persistLocalSnapshot(snapshot);
        return response({ session: updated });
      }
      if (method === "DELETE") {
        const id = parsedUrl.searchParams.get("id");
        const next = snapshot.classes.filter((item) => item.id !== id);
        if (next.length === snapshot.classes.length) throw new Error("Class session not found in this browser workspace.");
        persistLocalSnapshot({ ...snapshot, classes: next });
        return response({ ok: true, id });
      }
    }

    if (parsedUrl.pathname === "/api/study-sessions") {
      if (method === "POST") {
        if (snapshot.focusSessions.some((item) => item.status === "running")) throw new Error("Finish or cancel your current focus session before starting another.");
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
        if (!title) throw new Error("A focus-session title is required.");
        const courseId = typeof body.course_id === "string" && body.course_id ? body.course_id : null;
        if (courseId && !snapshot.courses.some((item) => item.id === courseId)) throw new Error("Choose a course from this browser workspace.");
        const startedAt = typeof body.started_at === "string" && Number.isFinite(Date.parse(body.started_at)) ? new Date(body.started_at).toISOString() : now;
        const session: FocusSession = { id: makeLocalId("focus"), task_id: null, course_id: courseId, title, started_at: startedAt, ended_at: null, duration_seconds: 0, status: "running", notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null };
        persistLocalSnapshot({ ...snapshot, focusSessions: [session, ...snapshot.focusSessions] });
        return response({ session });
      }
      if (method === "PATCH") {
        const id = String(body.id ?? "");
        const index = snapshot.focusSessions.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("Focus session not found in this browser workspace.");
        const current = snapshot.focusSessions[index];
        const status = body.status === "completed" || body.status === "cancelled" || body.status === "running" ? body.status : current.status;
        const endDate = status === "running" ? null : (typeof body.ended_at === "string" && Number.isFinite(Date.parse(body.ended_at)) ? new Date(body.ended_at).toISOString() : current.ended_at || now);
        const seconds = endDate ? Math.max(0, Math.floor((Date.parse(endDate) - Date.parse(current.started_at)) / 1000)) : 0;
        const session: FocusSession = { ...current, title: typeof body.title === "string" ? body.title.trim().slice(0, 180) || current.title : current.title, notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : body.notes === null ? null : current.notes, status, ended_at: endDate, duration_seconds: seconds };
        snapshot.focusSessions[index] = session;
        persistLocalSnapshot(snapshot);
        return response({ session });
      }
    }

    if (parsedUrl.pathname === "/api/study-plans") {
      if (method === "POST") {
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 140) : "Daily plan";
        if (!title) throw new Error("Plan title cannot be empty.");
        const planDate = typeof body.plan_date === "string" ? body.plan_date : todayLocal();
        const parsedPlanDate = new Date(`${planDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate) || !Number.isFinite(parsedPlanDate.getTime()) || parsedPlanDate.toISOString().slice(0, 10) !== planDate) throw new Error("Plan date must be a real date in YYYY-MM-DD format.");
        const plan: StudyPlan = { id: makeLocalId("plan"), plan_date: planDate, title, summary: typeof body.summary === "string" ? body.summary.slice(0, 2000) : "", status: body.status === "accepted" || body.status === "archived" ? body.status : "draft", source: body.source === "ai" ? "ai" : "rules", plan_data: body.plan_data ?? [], created_at: now };
        persistLocalSnapshot({ ...snapshot, plans: [plan, ...snapshot.plans] });
        return response({ plan });
      }
      if (method === "PATCH") {
        const id = String(body.id ?? "");
        const index = snapshot.plans.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("Study plan not found in this browser workspace.");
        const current = snapshot.plans[index];
        const proposedDate = typeof body.plan_date === "string" ? body.plan_date : current.plan_date;
        const parsedDate = new Date(`${proposedDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== proposedDate) throw new Error("Plan date must be a real date in YYYY-MM-DD format.");
        const plan: StudyPlan = { ...current, title: typeof body.title === "string" ? body.title.trim().slice(0, 140) || current.title : current.title, summary: typeof body.summary === "string" ? body.summary.slice(0, 2000) : current.summary, status: body.status === "accepted" || body.status === "archived" || body.status === "draft" ? body.status : current.status, source: body.source === "ai" || body.source === "rules" ? body.source : current.source, plan_date: proposedDate, updated_at: now, plan_data: body.plan_data ?? current.plan_data };
        snapshot.plans[index] = plan;
        persistLocalSnapshot(snapshot);
        return response({ plan });
      }
      if (method === "DELETE") {
        const id = parsedUrl.searchParams.get("id");
        const next = snapshot.plans.filter((item) => item.id !== id);
        if (next.length === snapshot.plans.length) throw new Error("Study plan not found in this browser workspace.");
        persistLocalSnapshot({ ...snapshot, plans: next });
        return response({ ok: true, id });
      }
    }
    throw new Error(`Local demo mode does not support ${method} for ${parsedUrl.pathname}.`);
  }

  function exportLocalBackup() {
    const snapshot = readLocalResourceSnapshot();
    let plannerTasks: unknown[] = [];
    try {
      const storedTasks = window.localStorage.getItem("campusmate-tasks");
      const parsed = storedTasks ? JSON.parse(storedTasks) as unknown : [];
      if (Array.isArray(parsed)) plannerTasks = parsed;
    } catch { /* preserve the rest of the resource backup if task storage is unreadable */ }
    const payload = { product: "CampusMate AI", backupVersion: 1, exportedAt: new Date().toISOString(), resources: snapshot, plannerTasks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `campusmate-local-backup-${todayLocal()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setNotice("Local workspace backup exported as JSON.");
  }

  async function importLocalBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Backup files must be smaller than 5 MB.");
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed.product !== "CampusMate AI" || parsed.backupVersion !== 1 || !parsed.resources || typeof parsed.resources !== "object") {
        throw new Error("This is not a supported CampusMate AI backup file.");
      }
      const raw = parsed.resources as Record<string, unknown>;
      const arrays = ["courses", "classes", "focusSessions", "plans"] as const;
      for (const key of arrays) {
        if (!Array.isArray(raw[key])) throw new Error(`The backup is missing the ${key} list.`);
        if (raw[key].length > 500) throw new Error(`The ${key} list is unusually large for a local backup.`);
      }
      const imported: LocalResourceSnapshot = {
        version: 1,
        courses: raw.courses as Course[],
        classes: raw.classes as ClassSession[],
        focusSessions: raw.focusSessions as FocusSession[],
        plans: raw.plans as StudyPlan[],
      };
      const validCourses = imported.courses.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && item.title.trim().length > 0);
      const validClasses = imported.classes.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && item.title.trim().length > 0 && Number.isFinite(Date.parse(item.starts_at)) && Number.isFinite(Date.parse(item.ends_at)) && Date.parse(item.ends_at) > Date.parse(item.starts_at));
      const validFocus = imported.focusSessions.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && item.title.trim().length > 0 && Number.isFinite(Date.parse(item.started_at)) && ["running", "completed", "cancelled"].includes(item.status) && Number.isFinite(item.duration_seconds) && item.duration_seconds >= 0 && (item.ended_at === null || item.ended_at === undefined || Number.isFinite(Date.parse(item.ended_at))));
      const validPlans = imported.plans.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && item.title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.plan_date) && ["draft", "accepted", "archived"].includes(item.status));
      if (!validCourses || !validClasses || !validFocus || !validPlans) throw new Error("The backup contains resource records with invalid fields.");
      if (imported.focusSessions.filter((item) => item.status === "running").length > 1) throw new Error("The backup has multiple running focus sessions. Edit the backup or export a fresh one.");
      const tasks = parsed.plannerTasks;
      if (!Array.isArray(tasks) || tasks.length > 40 || !tasks.every((item) => {
        if (!item || typeof item !== "object") return false;
        const task = item as Record<string, unknown>;
        return (typeof task.id === "number" || typeof task.id === "string") && typeof task.title === "string" && task.title.trim().length > 0 && typeof task.detail === "string" && typeof task.time === "string" && typeof task.duration === "string" && ["Low", "Medium", "High", "Today", "Soon", "Whenever"].includes(String(task.priority)) && typeof task.done === "boolean" && ["study", "class", "life"].includes(String(task.kind));
      })) throw new Error("The backup's planner task list is missing or contains invalid records.");
      persistLocalSnapshot(imported);
      window.localStorage.setItem("campusmate-tasks", JSON.stringify(tasks));
      setAccessState("local");
      setNotice("Backup imported to this browser. Return to Today to see the restored planner tasks.");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import that backup file.");
    }
  }

  useEffect(() => {
    try { setDarkTone(window.localStorage.getItem("campusmate-color-tone") === "sky-purple"); } catch { /* use the daylight default */ }
    const syncTone = (event: StorageEvent) => { if (event.key === "campusmate-color-tone") setDarkTone(event.newValue === "sky-purple"); };
    window.addEventListener("storage", syncTone);
    void loadAll();
    setClassStart(localDateTimeOffset(30));
    setClassEnd(localDateTimeOffset(90));
    setPlanDateDraft(todayLocal());
    setClock(Date.now());
    setTodayStamp(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase());
    return () => window.removeEventListener("storage", syncTone);
  }, [loadAll]);

  useEffect(() => {
    if (!focusSessions.some((session) => session.status === "running")) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [focusSessions]);

  const runningSession = useMemo(() => focusSessions.find((session) => session.status === "running") ?? null, [focusSessions]);
  const courseName = useCallback((id: string | null) => courses.find((course) => course.id === id)?.title ?? "Independent study", [courses]);

  async function perform(action: () => Promise<unknown>, successMessage: string, refresh = true) {
    setBusy(true); setError(""); setNotice("");
    try {
      await action();
      if (refresh) await loadAll(true);
      // Keep the dashboard's schedule snapshot current after cloud and local writes.
      window.dispatchEvent(new Event("campusmate:resources-updated"));
      setNotice(successMessage);
    } catch (caught) {
      const issue = caught as ApiError;
      setError(issue.message || "That action did not complete. Please try again.");
      if (issue.status === 401) setAccessState("signin");
      else if (issue.status === 503) setAccessState("setup");
    } finally { setBusy(false); }
  }

  async function submitCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { title: courseTitle.trim(), course_code: courseCode.trim() || null, instructor: instructor.trim() || null };
    if (!payload.title) return setError("Add a course name before saving.");
    await perform(async () => {
      if (courseId) await resourceRequest("/api/courses", { method: "PATCH", body: JSON.stringify({ id: courseId, ...payload }) });
      else await resourceRequest("/api/courses", { method: "POST", body: JSON.stringify(payload) });
      setCourseId(null); setCourseTitle(""); setCourseCode(""); setInstructor("");
    }, courseId ? "Course updated." : "Course added.");
  }

  function editCourse(course: Course) {
    setSection("courses"); setCourseId(course.id); setCourseTitle(course.title); setCourseCode(course.course_code ?? ""); setInstructor(course.instructor ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classTitle.trim()) return setError("Give this class session a title.");
    if (!classStart || !classEnd || new Date(classEnd) <= new Date(classStart)) return setError("The class must end after it starts.");
    const isEditing = Boolean(classSessionId);
    await perform(async () => {
      await resourceRequest("/api/class-sessions", { method: isEditing ? "PATCH" : "POST", body: JSON.stringify({
        ...(classSessionId ? { id: classSessionId } : {}), title: classTitle.trim(), course_id: classCourseId || null, location: classLocation.trim() || null,
        starts_at: new Date(classStart).toISOString(), ends_at: new Date(classEnd).toISOString(),
      }) });
      setClassSessionId(null); setClassTitle(""); setClassLocation(""); setClassCourseId("");
      setClassStart(localDateTimeOffset(30)); setClassEnd(localDateTimeOffset(90));
    }, isEditing ? "Class session updated." : "Class session saved.");
  }

  function editClassSession(item: ClassSession) {
    setSection("courses");
    setError("");
    setNotice(`Editing “${item.title}”. Update the fields below, then choose Save changes.`);
    setClassSessionId(item.id);
    setClassTitle(item.title);
    setClassCourseId(item.course_id ?? "");
    setClassLocation(item.location ?? "");
    setClassStart(localDateTimeFromIso(item.starts_at));
    setClassEnd(localDateTimeFromIso(item.ends_at));

    // The class editor is below the course editor. Scroll directly to it rather
    // than to the top of the page, where the edit form would remain off-screen.
    window.requestAnimationFrame(() => {
      classFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => classTitleInputRef.current?.focus({ preventScroll: true }), 350);
    });
  }

  async function startFocus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!focusTitle.trim()) return setError("Give your focus session a title.");
    await perform(async () => {
      await resourceRequest("/api/study-sessions", { method: "POST", body: JSON.stringify({ title: focusTitle.trim(), course_id: focusCourseId || null, notes: focusNotes.trim() || null }) });
      setFocusTitle(""); setFocusNotes(""); setFocusCourseId("");
    }, "Focus session started.");
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const steps = planSteps.split("\n").map((step) => step.trim()).filter(Boolean).slice(0, 24);
    if (!planTitle.trim()) return setError("Give your plan a title.");
    if (!steps.length) return setError("Add at least one step to the plan.");
    if (!planDateDraft) return setError("Choose a date for the plan.");
    const isEditing = Boolean(planId);
    await perform(async () => {
      await resourceRequest("/api/study-plans", { method: isEditing ? "PATCH" : "POST", body: JSON.stringify({
        ...(planId ? { id: planId } : {}), title: planTitle.trim(), summary: planSummary.trim(), plan_date: planDateDraft, source: "rules", status: "draft",
        plan_data: steps.map((title, index) => ({ order: index + 1, title, status: "proposed" })),
      }) });
      setPlanId(null); setPlanTitle("My study plan"); setPlanDateDraft(todayLocal()); setPlanSummary(""); setPlanSteps("Review today's top priority\nTake a short break\nFinish one focused practice block");
    }, isEditing ? "Study plan updated as a draft. Review and accept it when ready." : "Study plan saved.");
  }

  function editPlan(plan: StudyPlan) {
    const steps = Array.isArray(plan.plan_data) ? plan.plan_data.map((step) => step && typeof step === "object" ? String((step as Record<string, unknown>).title ?? (step as Record<string, unknown>).label ?? "") : String(step ?? "")).filter(Boolean) : [];
    setSection("plans"); setPlanId(plan.id); setPlanTitle(plan.title); setPlanDateDraft(plan.plan_date); setPlanSummary(plan.summary ?? "");
    setPlanSteps(steps.length ? steps.join("\n") : "Review today's top priority\nTake a short break");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const meta = sectionCopy[section];
  return <main className={`resource-shell ${darkTone ? "theme-sky-purple" : "theme-light"}`}>
    <div className="resource-atmosphere" aria-hidden="true" />
    <header className="resource-topbar">
      <Link className="resource-brand" href="/">campus<span>mate</span><small>YOUR DAY, YOUR WAY</small></Link>
      <nav aria-label="Resource page navigation"><Link href="/">Today</Link><Link href="/auth">Account</Link></nav>
    </header>

    <section className="resource-content">
      <div className="resource-breadcrumb"><Link href="/">MY SPACE</Link><span>/</span><strong>COURSES & SESSIONS</strong><span className="resource-live-dot"/> {accessState === "ready" ? "CLOUD CONNECTED" : accessState === "local" ? "LOCAL DEMO" : accessState === "unknown" ? "CHECKING ACCESS" : "SETUP NEEDED"}</div>
      <div className="resource-hero">
        <div><span className="resource-eyebrow">CAMPUSMATE / YOUR LEARNING SPACE</span><h1>Build a rhythm<br/><em>that belongs to you.</em></h1><p>Courses, classes, focus sessions, and saved plans in one small, calm workspace.</p></div>
        <div className="resource-date-stamp"><span>TODAY</span><strong>{todayStamp}</strong><small>One thing at a time.</small></div>
      </div>

      {accessState === "signin" && <div className="resource-callout"><strong>Sign in to keep this space personal.</strong><span>These resource APIs use your Supabase session and only read or write records owned by your account.</span><Link href="/auth">Sign in / create account ↗</Link></div>}
      {accessState === "local" && <div className="resource-callout resource-local-callout"><strong>Local demo mode · saved in this browser.</strong><span>Courses, classes, focus sessions, and plans work without AWS or Supabase credentials. This data does not sync to another device or account. Connect Supabase for account-backed cloud storage.</span><div className="resource-callout-actions"><button type="button" onClick={exportLocalBackup}>Export local backup ↓</button><button type="button" onClick={() => backupInputRef.current?.click()}>Import backup ↑</button><input ref={backupInputRef} className="resource-backup-input" type="file" accept="application/json,.json" onChange={(event) => { void importLocalBackup(event.target.files?.[0]); event.currentTarget.value = ""; }}/><Link href="/auth">Set up cloud sync ↗</Link></div></div>}
      {accessState === "setup" && <div className="resource-callout"><strong>Connect Supabase to save your work.</strong><span>Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and publishable key, apply the SQL schema, then restart the server.</span><Link href="/auth">Open account setup ↗</Link></div>}
      {error && <div className="resource-alert" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="resource-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

      <div className="resource-workspace">
        <aside className="resource-rail" aria-label="Learning sections">
          <span className="resource-rail-label">YOUR TOOLKIT</span>
          {(["courses", "focus", "plans"] as Section[]).map((id) => <button key={id} onClick={() => { setSection(id); setError(""); setNotice(""); }} className={section === id ? "selected" : ""}><span>{sectionCopy[id].number}</span>{id === "courses" ? "Courses & classes" : id === "focus" ? "Focus sessions" : "Saved plans"}<b>{id === "courses" ? courses.length + classes.length : id === "focus" ? focusSessions.length : plans.length}</b></button>)}
          <div className="resource-rail-note"><span>FIELD NOTE</span><p>A useful plan leaves room for breaks, changes, and being human.</p></div>
        </aside>

        <section className="resource-panel">
          <div className="resource-panel-heading"><div><span className="resource-eyebrow">{meta.number} / {meta.label}</span><h2>{meta.heading}</h2><p>{meta.description}</p></div></div>
          {loading && accessState === "unknown" ? <div className="resource-loading"><span className="resource-spinner"/> Gathering your learning space…</div> : <>
            {section === "courses" && <div className="resource-two-col">
              <form className="resource-form-card" onSubmit={submitCourse}>
                <span className="resource-form-kicker">{courseId ? "UPDATE SUBJECT" : "ADD A SUBJECT"}</span>
                <h3>{courseId ? "Edit this course." : "What are you learning?"}</h3>
                <label>Course name<input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} maxLength={140} required placeholder="e.g. Data Structures"/></label>
                <div className="resource-form-pair"><label>Course code <small>OPTIONAL</small><input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} maxLength={32} placeholder="CSE-201"/></label><label>Instructor <small>OPTIONAL</small><input value={instructor} onChange={(event) => setInstructor(event.target.value)} maxLength={100} placeholder="Instructor name"/></label></div>
                <div className="resource-form-actions"><button className="resource-primary" disabled={busy || !canManageResources}>{busy ? "SAVING…" : courseId ? "Save changes ↗" : "Add course ↗"}</button>{courseId && <button className="resource-secondary" type="button" onClick={() => { setCourseId(null); setCourseTitle(""); setCourseCode(""); setInstructor(""); }}>Cancel</button>}</div>
              </form>
              <div className="resource-list-card"><div className="resource-list-head"><div><span className="resource-form-kicker">YOUR SUBJECTS</span><h3>{courses.length ? `${courses.length} course${courses.length === 1 ? "" : "s"} in your space` : "A place to begin."}</h3></div><span className="resource-count">{String(courses.length).padStart(2, "0")}</span></div>
                {courses.length ? <div className="resource-record-list">{courses.map((course, index) => <article className="resource-record" key={course.id}><span className="resource-record-index">{String(index + 1).padStart(2, "0")}</span><div className="resource-record-main"><strong>{course.title}</strong><span>{[course.course_code, course.instructor].filter(Boolean).join(" · ") || "Course details can be added later."}</span></div><div className="resource-record-actions"><button className="resource-action-button" aria-label={`Edit course ${course.title}`} onClick={() => editCourse(course)} disabled={busy}>EDIT</button><button className="resource-action-button resource-action-danger" aria-label={`Remove course ${course.title}`} disabled={busy} onClick={() => { if (window.confirm(`Delete “${course.title}”? Existing class and focus sessions will no longer be linked to it.`)) void perform(() => resourceRequest(`/api/courses?id=${encodeURIComponent(course.id)}`, { method: "DELETE" }), "Course deleted."); }}>REMOVE</button></div></article>)}</div> : <div className="resource-empty"><strong>No courses saved yet.</strong><span>Add a subject on the left to begin connecting classes and study time.</span></div>}
              </div>
            </div>}

            {section === "courses" && <div className="resource-two-col resource-class-workspace">
              <form ref={classFormRef} className={`resource-form-card resource-class-form ${classSessionId ? "is-editing" : ""}`} onSubmit={submitClass}>
                <span className="resource-form-kicker">{classSessionId ? "UPDATE THE TIMETABLE" : "ADD TO THE TIMETABLE"}</span><h3>{classSessionId ? "Edit this commitment." : "Put a class on the map."}</h3>
                {classSessionId && <p className="resource-class-editing-note" role="status">You're editing a saved class. Your original session stays in place until you save these changes.</p>}
                <label>Class or lecture title<input ref={classTitleInputRef} value={classTitle} onChange={(event) => setClassTitle(event.target.value)} maxLength={180} required placeholder="e.g. Applied Physics lecture"/></label>
                <label>Related course<select value={classCourseId} onChange={(event) => setClassCourseId(event.target.value)}><option value="">No course selected</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
                <label>Location <small>OPTIONAL</small><input value={classLocation} onChange={(event) => setClassLocation(event.target.value)} maxLength={120} placeholder="e.g. Block C · Room 204"/></label>
                <div className="resource-form-pair"><label>Starts<input type="datetime-local" required value={classStart} onChange={(event) => setClassStart(event.target.value)}/></label><label>Ends<input type="datetime-local" required value={classEnd} onChange={(event) => setClassEnd(event.target.value)}/></label></div>
                <div className="resource-form-actions"><button className="resource-primary" disabled={busy || !canManageResources}>{busy ? "SAVING…" : classSessionId ? "Save changes ↗" : "Save class ↗"}</button>{classSessionId && <button className="resource-secondary" type="button" onClick={() => { setClassSessionId(null); setClassTitle(""); setClassCourseId(""); setClassLocation(""); setClassStart(localDateTimeOffset(30)); setClassEnd(localDateTimeOffset(90)); }}>Cancel</button>}</div>
              </form>
              <div className="resource-list-card"><div className="resource-list-head"><div><span className="resource-form-kicker">UPCOMING COMMITMENTS</span><h3>{classes.length ? `${classes.length} scheduled session${classes.length === 1 ? "" : "s"}` : "Your schedule, gently started."}</h3></div><span className="resource-count">{String(classes.length).padStart(2, "0")}</span></div>
                {classes.length ? <div className="resource-record-list">{[...classes].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map((item, index) => <article className="resource-record resource-record-tall" key={item.id}><span className="resource-record-index">{String(index + 1).padStart(2, "0")}</span><div className="resource-record-main"><strong>{item.title}</strong><span>{dateLabel(item.starts_at)} – {new Date(item.ends_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span><small>{courseName(item.course_id)}{item.location ? ` · ${item.location}` : ""}</small></div><div className="resource-record-actions"><button type="button" className="resource-action-button resource-action-edit" aria-label={`Edit schedule entry ${item.title}`} disabled={busy} onClick={() => editClassSession(item)}>EDIT CLASS</button><button type="button" className="resource-action-button resource-action-danger" aria-label={`Remove schedule entry ${item.title}`} disabled={busy} onClick={() => { if (window.confirm(`Remove “${item.title}” from your schedule?`)) void perform(() => resourceRequest(`/api/class-sessions?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }), "Class session removed."); }}>REMOVE</button></div></article>)}</div> : <div className="resource-empty"><strong>No classes scheduled yet.</strong><span>Add a lecture or lab to give your week a little structure.</span></div>}
              </div>
            </div>}

            {section === "focus" && <div className="resource-focus-layout">
              <form className="resource-form-card" onSubmit={startFocus}>
                <span className="resource-form-kicker">START WITH ONE THING</span><h3>{runningSession ? "Your focus is underway." : "Choose a small next step."}</h3>
                <label>What are you working on?<input value={focusTitle} onChange={(event) => setFocusTitle(event.target.value)} maxLength={180} placeholder="e.g. Practise BST deletion" required/></label>
                <label>Related course<select value={focusCourseId} onChange={(event) => setFocusCourseId(event.target.value)}><option value="">Independent study</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
                <label>Note to remember <small>OPTIONAL</small><textarea value={focusNotes} onChange={(event) => setFocusNotes(event.target.value)} maxLength={1000} rows={3} placeholder="A useful sub-goal, resource, or stopping point…"/></label>
                <div className="resource-form-actions"><button className="resource-primary" disabled={busy || !canManageResources || Boolean(runningSession)}>{runningSession ? "FINISH THE CURRENT SESSION FIRST" : busy ? "STARTING…" : "Start focus session ↗"}</button></div>
                {runningSession && <p className="resource-inline-note">One running session at a time keeps your recorded focus time clear.</p>}
              </form>
              <div className="resource-list-card resource-focus-card"><span className="resource-form-kicker">FOCUS LOG</span><h3>Time spent, without judgment.</h3>
                {runningSession && <div className="resource-running-card"><span className="resource-running-pulse"/><span className="resource-running-label">IN FOCUS NOW</span><strong>{durationLabel(Math.floor(Math.max(0, clock - Date.parse(runningSession.started_at)) / 1000))}</strong><p>{runningSession.title}</p><small>{courseName(runningSession.course_id)} · started {dateLabel(runningSession.started_at)}</small><div><button className="resource-primary" disabled={busy} onClick={() => void perform(() => resourceRequest("/api/study-sessions", { method: "PATCH", body: JSON.stringify({ id: runningSession.id, status: "completed" }) }), "Focus session completed.")}>Finish session ✓</button><button className="resource-secondary" disabled={busy} onClick={() => void perform(() => resourceRequest("/api/study-sessions", { method: "PATCH", body: JSON.stringify({ id: runningSession.id, status: "cancelled" }) }), "Focus session cancelled.")}>Cancel</button></div></div>}
                {focusSessions.length ? <div className="resource-record-list">{focusSessions.filter((session) => session.id !== runningSession?.id).map((session, index) => <article className="resource-record resource-record-tall" key={session.id}><span className="resource-record-index">{String(index + 1).padStart(2, "0")}</span><div className="resource-record-main"><strong>{session.title}</strong><span>{dateLabel(session.started_at)} · {durationLabel(session.duration_seconds)}</span><small>{courseName(session.course_id)} · {session.status.toUpperCase()}</small></div>{session.status === "running" && <button className="resource-primary resource-mini-button" disabled={busy} onClick={() => void perform(() => resourceRequest("/api/study-sessions", { method: "PATCH", body: JSON.stringify({ id: session.id, status: "completed" }) }), "Focus session completed.")}>FINISH</button>}</article>)}</div> : !runningSession && <div className="resource-empty"><strong>Your first session can be small.</strong><span>Start a focus block and finish it when you're ready. {accessState === "local" ? "Completed time stays in this browser." : "Completed time will be stored with your account."}</span></div>}
              </div>
            </div>}

            {section === "plans" && <div className="resource-two-col">
              <form className="resource-form-card" onSubmit={savePlan}>
                <span className="resource-form-kicker">{planId ? "EDIT A SAVED PLAN" : "SAVE A DRAFT"}</span><h3>{planId ? "Tune the next steps." : "Make the next steps visible."}</h3>
                <label>Plan title<input value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} maxLength={140} required/></label>
                <label>Plan date<input type="date" value={planDateDraft} onChange={(event) => setPlanDateDraft(event.target.value)} required/></label>
                <label>Short summary <small>OPTIONAL</small><textarea value={planSummary} onChange={(event) => setPlanSummary(event.target.value)} rows={2} maxLength={2000} placeholder="What makes this plan useful today?"/></label>
                <label>One step per line<textarea value={planSteps} onChange={(event) => setPlanSteps(event.target.value)} rows={5} maxLength={8000} required placeholder="Review notes\nComplete practice questions\nTake a break"/></label>
                <p className="resource-inline-note">Saved as a rules-based draft. A live Bedrock response is only labeled AI when the model call succeeds.</p>
                <div className="resource-form-actions"><button className="resource-primary" disabled={busy || !canManageResources}>{busy ? "SAVING…" : planId ? "Update draft ↗" : "Save plan ↗"}</button>{planId && <button className="resource-secondary" type="button" onClick={() => { setPlanId(null); setPlanTitle("My study plan"); setPlanDateDraft(todayLocal()); setPlanSummary(""); setPlanSteps("Review today's top priority\nTake a short break\nFinish one focused practice block"); }}>Cancel</button>}</div>
              </form>
              <div className="resource-list-card"><div className="resource-list-head"><div><span className="resource-form-kicker">PLAN SHELF</span><h3>{plans.length ? `${plans.length} saved plan${plans.length === 1 ? "" : "s"}` : "A shelf for plans worth keeping."}</h3></div><span className="resource-count">{String(plans.length).padStart(2, "0")}</span></div>
                {plans.length ? <div className="resource-record-list">{plans.map((plan, index) => { const steps = Array.isArray(plan.plan_data) ? plan.plan_data.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object") : []; return <article className="resource-plan-record" key={plan.id}><div className="resource-plan-record-top"><span className="resource-record-index">{String(index + 1).padStart(2, "0")}</span><span className={`resource-status-pill status-${plan.status}`}>{plan.status.toUpperCase()}</span><span className="resource-plan-date">{plan.plan_date}</span></div><h4>{plan.title}</h4>{plan.summary && <p>{plan.summary}</p>}{steps.length > 0 && <ol>{steps.slice(0, 5).map((step, stepIndex) => <li key={stepIndex}>{String(step.title ?? step.label ?? "Plan step")}</li>)}</ol>}<div className="resource-plan-actions"><button disabled={busy} onClick={() => editPlan(plan)}>EDIT</button>{plan.status !== "accepted" && <button disabled={busy} onClick={() => void perform(() => resourceRequest("/api/study-plans", { method: "PATCH", body: JSON.stringify({ id: plan.id, status: "accepted" }) }), "Plan accepted.")}>ACCEPT PLAN</button>}{plan.status !== "archived" && <button disabled={busy} onClick={() => void perform(() => resourceRequest("/api/study-plans", { method: "PATCH", body: JSON.stringify({ id: plan.id, status: "archived" }) }), "Plan archived.")}>ARCHIVE</button>}<button className="resource-danger-link" disabled={busy} onClick={() => { if (window.confirm(`Delete “${plan.title}”?`)) void perform(() => resourceRequest(`/api/study-plans?id=${encodeURIComponent(plan.id)}`, { method: "DELETE" }), "Plan deleted."); }}>DELETE</button></div></article>; })}</div> : <div className="resource-empty"><strong>No plans saved yet.</strong><span>Write a few steps on the left. You can accept or archive a draft later.</span></div>}
              </div>
            </div>}
          </>}
        </section>
      </div>
      <footer className="resource-footer"><span>CAMPUSMATE / FIELD NOTES</span><span>One thing at a time. You're doing alright.</span><Link href="/">Back to your day ↗</Link></footer>
    </section>
  </main>;
}
