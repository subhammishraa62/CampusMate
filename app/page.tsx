"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildRuleBasedBrief } from "@/lib/planning/engine";
import { parseTaskIntent, parseTaskIntents, rescheduleTaskProposal, type ActionTaskProposal } from "@/lib/planning/action-parser";
import { findDuplicatePlanningTask } from "@/lib/planning/duplicate-task";
import type { DailyBrief } from "@/lib/planning/types";

type Scene = "terrace" | "orbit" | "greenhouse" | "bluehour";
type TaskPriority = "Low" | "Medium" | "High";
type Task = { id: number; title: string; detail: string; time: string; duration: string; priority: TaskPriority; done: boolean; kind: "study" | "class" | "life"; scheduledDate?: string; startTime?: string; endTime?: string; deadlineDate?: string; deadlineTime?: string; reminderMinutes?: number | null; courseId?: string | null };
type StudentProfile = { displayName: string; college: string; course: string; branch: string; studyYear: string; semester: string; bio: string; studyGoalHours: string; preferredStart: string; preferredEnd: string; avatarUrl: string };
const motivationalQuotes = [
  { kicker: "A NOTE TO SELF", text: "One thing at a time.\nYou’re doing alright." },
  { kicker: "A GENTLE REMINDER", text: "Progress counts,\neven when it’s quiet." },
  { kicker: "TAKE A BREATH", text: "You don’t have to\nfigure it all out today." },
  { kicker: "KEEP GOING", text: "Small steps still\nmove you forward." },
  { kicker: "A NOTE TO SELF", text: "Rest is part of\nthe plan, too." },
  { kicker: "A LITTLE PERSPECTIVE", text: "Done is better than\nperfect and postponed." },
  { kicker: "YOU’VE GOT THIS", text: "Start where you are.\nUse what you have." },
  { kicker: "A QUIET WIN", text: "A focused ten minutes\nis still a beginning." },
  { kicker: "BE KIND TO YOU", text: "Your pace is allowed\nto look like yours." },
  { kicker: "ONE DAY AT A TIME", text: "You can try again\nwithout starting over." },
  { kicker: "A NOTE TO SELF", text: "Make space for life,\nnot just the checklist." },
  { kicker: "KEEP IT HUMAN", text: "You’re a person,\nnot a productivity score." },
  { kicker: "A FRESH START", text: "The next small step\nis enough for now." },
  { kicker: "STEADY DOES IT", text: "You can be proud\nof showing up." },
  { kicker: "TAKE THE PRESSURE OFF", text: "You’re allowed to learn\nas you go." },
  { kicker: "A LITTLE COURAGE", text: "Begin before it feels\nperfectly clear." },
  { kicker: "A NOTE TO SELF", text: "One hard moment\nisn’t the whole story." },
  { kicker: "SLOW IS STILL FORWARD", text: "Consistency can be\nquiet and imperfect." },
  { kicker: "MAKE ROOM", text: "Your future self needs\nyour care, not panic." },
  { kicker: "BE HERE NOW", text: "Choose the next thing,\nnot every thing." },
  { kicker: "A SOFTER PLAN", text: "Leave a little room\nfor the unexpected." },
  { kicker: "YOU’RE LEARNING", text: "Not knowing yet\nis part of knowing." },
  { kicker: "SMALL WINS", text: "Every finished step\nlightens the load." },
  { kicker: "A NOTE TO SELF", text: "Your best today\ncan look different." },
  { kicker: "KEEP THE FAITH", text: "You’ve made it through\nhard days before." },
];
function normalizePriority(value: unknown): TaskPriority {
  if (value === "Low" || value === "Medium" || value === "High") return value;
  if (value === "Today") return "High";
  if (value === "Whenever") return "Low";
  return "Medium";
}
function dateInLocalTime(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function humanTime(value: string): string {
  if (!value) return "Not scheduled";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour) || !minuteText) return value;
  return `${hour % 12 || 12}:${minuteText} ${hour >= 12 ? "PM" : "AM"}`;
}
function formatScheduleTimeRange(startTime?: string, endTime?: string, fallback = "Not scheduled"): string {
  if (!startTime || !endTime) return fallback;
  const start = humanTime(startTime);
  const end = humanTime(endTime);
  if (start === "Not scheduled" || end === "Not scheduled") return fallback;
  const startPeriod = start.match(/\s(AM|PM)$/i)?.[1]?.toUpperCase();
  const endPeriod = end.match(/\s(AM|PM)$/i)?.[1]?.toUpperCase();
  const compactStart = startPeriod && startPeriod === endPeriod ? start.replace(/\s(?:AM|PM)$/i, "") : start;
  return `${compactStart}–${end}`;
}
function taskDuration(start: string, end: string): string {
  if (!start || !end) return "30 min";
  const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return "30 min";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hr`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} min`;
}
type ResourceCourse = { id: string; title: string; course_code?: string | null };
type ResourceClassSession = { id: string; course_id: string | null; title: string; location: string | null; starts_at: string; ends_at: string; notes?: string | null };
type ScheduleEntry = { key: string; title: string; detail: string; time: string; duration: string; startTime?: string; endTime?: string; done: boolean; kind: "study" | "class" | "life" };
type McpDemoPayload = {
  ok?: boolean;
  protocol?: string;
  server?: { name?: string; version?: string } | null;
  tools?: string[];
  calls?: string[];
  openTaskCount?: number | null;
  brief?: DailyBrief;
  provider?: string;
  bedrockStatus?: string;
  source?: string;
  error?: string;
  hint?: string;
};
// These were dashboard demo rows in older versions. Filter them during hydration
// and cloud loading so they cannot leak into a new user's task list.
const demoTaskTitles = new Set([
  "Finish DSA assignment",
  "Physics lecture",
  "Submit lab observation",
  "Lunch away from my desk",
]);
function withoutDemoTasks(items: Task[]): Task[] {
  return items.filter((task) => !demoTaskTitles.has(task.title.trim()));
}
const scenes: { id: Scene; name: string; note: string; image: string; tone: string }[] = [
  { id: "terrace", name: "Sky terrace", note: "Warm light, open horizon", image: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=2200&q=85", tone: "#e8c9a8" },
  { id: "orbit", name: "Quiet orbit", note: "Deep space, soft colour", image: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=2200&q=85", tone: "#aaa4e9" },
  { id: "greenhouse", name: "Glasshouse", note: "A little green, a little calm", image: "https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=2200&q=85", tone: "#a5c5ad" },
  { id: "bluehour", name: "Blue hour", note: "City lights after rain", image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=2200&q=85", tone: "#9da9d0" },
];
const nav = ["Today", "Schedule", "Tasks", "My week"];

// Background atmosphere follows the student's local time. Manual scenery choices
// remain available, and switching back to Auto restores the time-aware scene.
function sceneForHour(hour: number): Scene {
  if (hour >= 5 && hour < 11) return "terrace";       // morning light
  if (hour >= 11 && hour < 16) return "greenhouse";  // bright afternoon
  if (hour >= 16 && hour < 20) return "terrace";     // golden hour
  if (hour >= 20 || hour < 5) return "bluehour";     // evening / night
  return "orbit";
}

function timeLabel(hour: number) {
  if (hour >= 5 && hour < 11) return "MORNING LIGHT";
  if (hour >= 11 && hour < 16) return "AFTERNOON CALM";
  if (hour >= 16 && hour < 20) return "GOLDEN HOUR";
  return "AFTER HOURS";
}

function estimateDurationMinutes(value: string): number {
  const match = value.match(/(\d+)\s*(min(?:ute)?s?|hr|hours?)/i);
  if (!match) return 30;
  const amount = Number(match[1]);
  return /hr|hour/i.test(match[2]) ? amount * 60 : amount;
}
function clockToMinutes(value?: string): number | null {
  const match = (value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
function localMinutesFromTimestamp(value?: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}
function scheduleBlockConflicts(date: string, startTime: string, endTime: string, classes: ResourceClassSession[], tasks: Task[]): boolean {
  const start = clockToMinutes(startTime); const end = clockToMinutes(endTime);
  if (!date || start === null || end === null || end <= start) return true;
  for (const item of classes) {
    const startDate = item.starts_at ? new Date(item.starts_at) : null;
    const classStart = localMinutesFromTimestamp(item.starts_at);
    const classEnd = localMinutesFromTimestamp(item.ends_at);
    if (!startDate || !Number.isFinite(startDate.getTime()) || dateInLocalTime(startDate) !== date || classStart === null || classEnd === null) continue;
    if (start < classEnd && end > classStart) return true;
  }
  for (const task of tasks) {
    if (task.scheduledDate !== date || !task.startTime) continue;
    const taskStart = clockToMinutes(task.startTime);
    if (taskStart === null) continue;
    const taskEnd = clockToMinutes(task.endTime) ?? (taskStart + estimateDurationMinutes(task.duration));
    if (start < taskEnd && end > taskStart) return true;
  }
  return false;
}
function compactMinutes(value: number): string {
  const safe = Math.max(0, value);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

// Keep UI loading states bounded even if a route or provider stalls.
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 55_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function friendlyRequestError(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "This request took too long and was stopped. Your data has not been created. Check the VS Code terminal and try once more.";
  }
  return error instanceof Error ? error.message : fallback;
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("Today");
  const [routeTransition, setRouteTransition] = useState<{ phase: "cover" | "reveal"; target: string; id: number } | null>(null);
  const routeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const routeTransitionIdRef = useRef(0);
  const [profileName, setProfileName] = useState("Student");
  const [profileCourse, setProfileCourse] = useState("");
  const [profileYear, setProfileYear] = useState("");
  const [profileCollege, setProfileCollege] = useState("");
  const [profileBranch, setProfileBranch] = useState("");
  const [profileSemester, setProfileSemester] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileGoalHours, setProfileGoalHours] = useState("3");
  const [profilePreferredStart, setProfilePreferredStart] = useState("17:00");
  const [profilePreferredEnd, setProfilePreferredEnd] = useState("21:00");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resourceClasses, setResourceClasses] = useState<ResourceClassSession[]>([]);
  const [resourceCourses, setResourceCourses] = useState<ResourceCourse[]>([]);
  const [tasksHydrated, setTasksHydrated] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<"local" | "syncing" | "synced" | "error">("local");
  const [briefContext, setBriefContext] = useState("");
  const [briefData, setBriefData] = useState<DailyBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [mcpDemoLoading, setMcpDemoLoading] = useState(false);
  const [mcpDemoResult, setMcpDemoResult] = useState<McpDemoPayload | null>(null);
  const [mcpDemoError, setMcpDemoError] = useState("");
  const [automation, setAutomation] = useState<"guided" | "autopilot">("guided");
  const [scene, setScene] = useState<Scene>("terrace");
  const [localHour, setLocalHour] = useState(9);
  const [customBackground, setCustomBackground] = useState<string | null>(null);
  const [backgroundName, setBackgroundName] = useState("");
  const [darkTone, setDarkTone] = useState(false);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [taskDetailDraft, setTaskDetailDraft] = useState("");
  const [taskPriorityDraft, setTaskPriorityDraft] = useState<Task["priority"]>("Medium");
  const [taskTimeDraft, setTaskTimeDraft] = useState("Not scheduled");
  const [taskScheduledDateDraft, setTaskScheduledDateDraft] = useState("");
  const [taskStartTimeDraft, setTaskStartTimeDraft] = useState("");
  const [taskEndTimeDraft, setTaskEndTimeDraft] = useState("");
  const [taskDeadlineDateDraft, setTaskDeadlineDateDraft] = useState("");
  const [taskDeadlineTimeDraft, setTaskDeadlineTimeDraft] = useState("");
  const [taskReminderDraft, setTaskReminderDraft] = useState<number>(30);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [taskFilter, setTaskFilter] = useState<"All" | "Open" | "Done">("All");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [planPrompt, setPlanPrompt] = useState("");
  const [planGenerated, setPlanGenerated] = useState(false);
  const [planAccepted, setPlanAccepted] = useState(false);
  const [planBrief, setPlanBrief] = useState<DailyBrief | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaveError, setPlanSaveError] = useState("");
  const [taskProposal, setTaskProposal] = useState<ActionTaskProposal | null>(null);
  const [batchTaskProposals, setBatchTaskProposals] = useState<ActionTaskProposal[]>([]);
  const [batchScheduleNeedsReview, setBatchScheduleNeedsReview] = useState(false);
  const [focusOn, setFocusOn] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [showExtraToday, setShowExtraToday] = useState(false);
  const doneCount = tasks.filter(task => task.done).length;
  const remaining = tasks.length - doneCount;
  const activeScene = scenes.find(item => item.id === scene)!;
  const backgroundImage = customBackground || activeScene.image;
  const nextTask = tasks.find(task => !task.done);
  // Match AI proposals against existing tasks before showing create actions.
  // This intentionally includes completed tasks so a repeated request can reopen
  // and update the original item instead of creating a second copy.
  const existingTaskForProposal = taskProposal ? findDuplicatePlanningTask(tasks, taskProposal) : undefined;
  const greeting = localHour < 12 ? "Good morning." : localHour < 17 ? "Good afternoon." : localHour < 21 ? "Good evening." : "A quieter night, perhaps.";
  const today = new Date();
  const weekday = today.toLocaleDateString("en-IN", { weekday: "long" });
  const dateShort = today.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
  const localDateKey = dateInLocalTime(today);
  const dueTodayCount = tasks.filter(task => !task.done && task.deadlineDate === localDateKey).length;
  const highPriorityCount = tasks.filter(task => !task.done && task.priority === "High").length;
  const classSessionsToday = resourceClasses.filter((item) => {
    const start = new Date(item.starts_at);
    return Number.isFinite(start.getTime()) && `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}` === localDateKey;
  }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const plannerClassTasks: Task[] = classSessionsToday
    .filter((item) => !tasks.some((task) => task.kind === "class" && task.title.trim().toLocaleLowerCase() === item.title.trim().toLocaleLowerCase()))
    .map((item, index) => {
      const start = new Date(item.starts_at);
      const end = new Date(item.ends_at);
      const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
      const course = resourceCourses.find((candidate) => candidate.id === item.course_id)?.title;
      return {
        id: -(index + 1), title: item.title, detail: [course, item.location].filter(Boolean).join(" · ") || "Saved class commitment",
        time: start.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase(),
        startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
        endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
        duration: minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`,
        priority: "High", done: false, kind: "class" as const, courseId: item.course_id,
      };
    });
  const plannerTasks = [...tasks, ...plannerClassTasks];
  const scheduleEntries: ScheduleEntry[] = [
    ...tasks.filter(task => !task.scheduledDate || task.scheduledDate === localDateKey).map((task) => ({ key: `task-${task.id}`, title: task.title, detail: [task.courseId ? resourceCourses.find((course) => course.id === task.courseId)?.title : "", task.detail].filter(Boolean).join(" · "), time: task.time, duration: task.duration, startTime: task.startTime, endTime: task.endTime, done: task.done, kind: task.kind })),
    ...plannerClassTasks.map((task) => ({ key: `class-${task.id}`, title: task.title, detail: task.detail, time: task.time, duration: task.duration, startTime: task.startTime, endTime: task.endTime, done: false, kind: task.kind })),
  ].sort((a, b) => {
    const minuteOfDay = (value: string) => {
      const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return Number.MAX_SAFE_INTEGER;
      return (Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2]);
    };
    return minuteOfDay(a.time) - minuteOfDay(b.time);
  });
  // Detect overlapping scheduled entries for today's timeline. Prefer explicit
  // 24-hour start/end values; fall back to the displayed 12-hour time + duration.
  const scheduleConflictKeys = new Set<string>();
  const scheduleMinutes = (entry: ScheduleEntry) => {
    const parseClock = (value?: string): number | null => {
      if (!value) return null;
      const twentyFour = value.match(/^(\d{1,2}):(\d{2})$/);
      if (twentyFour) return Number(twentyFour[1]) * 60 + Number(twentyFour[2]);
      const twelveHour = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!twelveHour) return null;
      return (Number(twelveHour[1]) % 12 + (twelveHour[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(twelveHour[2]);
    };
    const start = parseClock(entry.startTime) ?? parseClock(entry.time);
    if (start === null || entry.time === "Not scheduled") return null;
    const explicitEnd = parseClock(entry.endTime);
    const end = explicitEnd !== null && explicitEnd > start ? explicitEnd : start + estimateDurationMinutes(entry.duration);
    return { start, end };
  };
  for (let i = 0; i < scheduleEntries.length; i += 1) {
    const first = scheduleMinutes(scheduleEntries[i]);
    if (!first) continue;
    for (let j = i + 1; j < scheduleEntries.length; j += 1) {
      const second = scheduleMinutes(scheduleEntries[j]);
      if (!second) continue;
      if (first.start < second.end && first.end > second.start) {
        scheduleConflictKeys.add(scheduleEntries[i].key);
        scheduleConflictKeys.add(scheduleEntries[j].key);
      }
    }
  }
  const visibleBrief = briefData ?? buildRuleBasedBrief(plannerTasks, briefContext);
  const completionRate = Math.round(doneCount / Math.max(tasks.length, 1) * 100);
  const estimatedOpenMinutes = tasks.filter((task) => !task.done).reduce((total, task) => total + estimateDurationMinutes(task.duration), 0);

  // Load the currently authenticated user's display name and optional course.
  // If Supabase is not configured or no user is signed in, keep the safe fallback.
  useEffect(() => {
    let active = true;

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return () => { active = false; };
    }

    function applyProfile(user: { user_metadata?: Record<string, unknown>; email?: string } | null) {
      if (!active) return;
      if (!user) {
        setProfileName("Student");
        setProfileCourse("");
        setProfileYear("");
        return;
      }

      const metadata = user.user_metadata ?? {};
      const displayName =
        (typeof metadata.display_name === "string" && metadata.display_name.trim()) ||
        (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
        (typeof metadata.name === "string" && metadata.name.trim()) ||
        user.email?.split("@")[0] ||
        "Student";

      setProfileName(displayName);
      setProfileCourse(typeof metadata.course === "string" ? metadata.course.trim() : "");
      setProfileYear(typeof metadata.study_year === "string" ? metadata.study_year.trim() : "");
    }

    void supabase.auth.getUser().then(({ data, error }) => {
      if (active && !error) applyProfile(data.user);
    }).catch(() => { /* Keep the safe fallback if auth is unavailable. */ });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Read the session user directly here; avoid making another auth request
      // inside the auth-state callback.
      applyProfile(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load the user's account-backed profile. When signed out or offline, use the
  // browser-local profile without copying it into another signed-in account.
  useEffect(() => {
    let active = true;
    const apply = (value: Partial<StudentProfile>) => {
      if (!active) return;
      if (typeof value.displayName === "string" && value.displayName.trim()) setProfileName(value.displayName.trim());
      if (typeof value.college === "string") setProfileCollege(value.college);
      if (typeof value.course === "string") setProfileCourse(value.course);
      if (typeof value.branch === "string") setProfileBranch(value.branch);
      if (typeof value.studyYear === "string") setProfileYear(value.studyYear);
      if (typeof value.semester === "string") setProfileSemester(value.semester);
      if (typeof value.bio === "string") setProfileBio(value.bio);
      if (typeof value.studyGoalHours === "string") setProfileGoalHours(value.studyGoalHours || "3");
      if (typeof value.preferredStart === "string") setProfilePreferredStart(value.preferredStart || "17:00");
      if (typeof value.preferredEnd === "string") setProfilePreferredEnd(value.preferredEnd || "21:00");
      if (typeof value.avatarUrl === "string") setProfileAvatarUrl(value.avatarUrl);
    };
    async function loadProfile() {
      let storageKey = "campusmate-profile-local";
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) storageKey = `campusmate-profile-local:${data.user.id}`;
      } catch { /* unsigned/local mode uses the browser-wide local profile */ }
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (response.ok) {
          const payload = await response.json() as { profile?: Partial<StudentProfile> };
          if (payload.profile) { apply(payload.profile); try { localStorage.setItem(storageKey, JSON.stringify(payload.profile)); } catch {} return; }
        }
      } catch { /* local profile is still available */ }
      try { const local = localStorage.getItem(storageKey); if (local) apply(JSON.parse(local) as Partial<StudentProfile>); } catch { /* keep current defaults */ }
    }
    void loadProfile();
    return () => { active = false; };
  }, []);

  // The quote stays put for the day, with a manual refresh button for anyone who
  // wants a different note. The choice is saved per browser and local date.
  useEffect(() => {
    const todayKey = dateInLocalTime(new Date());
    try {
      const stored = JSON.parse(localStorage.getItem("campusmate-daily-quote") || "null") as { date?: string; index?: number } | null;
      if (stored && stored.date === todayKey && Number.isInteger(stored.index)) { setQuoteIndex(Math.max(0, Math.min(motivationalQuotes.length - 1, stored.index!))); return; }
      const digits = todayKey.replace(/-/g, "").split("").reduce((total, char) => total + Number(char), 0);
      const index = digits % motivationalQuotes.length;
      setQuoteIndex(index);
      localStorage.setItem("campusmate-daily-quote", JSON.stringify({ date: todayKey, index }));
    } catch { setQuoteIndex(new Date().getDate() % motivationalQuotes.length); }
  }, []);

  // Deadline alerts use the browser Notification API while CampusMate is open.
  // A background push service is required for delivery when every tab is closed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkReminders = () => {
      const current = Date.now();
      tasks.forEach(task => {
        if (task.done || !task.deadlineDate || !task.deadlineTime || task.reminderMinutes === null || task.reminderMinutes === undefined) return;
        const target = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
        const reminderAt = target - task.reminderMinutes * 60_000;
        const key = `campusmate-reminder-fired:${task.id}:${task.deadlineDate}T${task.deadlineTime}:${task.reminderMinutes}`;
        if (Number.isFinite(target) && current >= reminderAt && current <= target + 10 * 60_000 && !localStorage.getItem(key)) {
          localStorage.setItem(key, "1");
          const message = task.reminderMinutes === 0 ? `“${task.title}” is due now.` : `“${task.title}” is due ${task.reminderMinutes >= 60 ? `in ${task.reminderMinutes / 60} hour${task.reminderMinutes === 60 ? "" : "s"}` : `in ${task.reminderMinutes} minutes`}.`;
          if ("Notification" in window && Notification.permission === "granted") new Notification("CampusMate reminder", { body: message, tag: key });
          else setToast(message);
        }
      });
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  // A restrained pointer field gives the atmosphere a little depth on desktop.
  // It is decorative only and intentionally disabled for touch and reduced motion.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".app-shell");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--pointer-x", `${event.clientX}px`);
        root.style.setProperty("--pointer-y", `${event.clientY}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); if (frame) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    try {
      const savedTasks = localStorage.getItem("campusmate-tasks");
      if (savedTasks) {
        const parsed = JSON.parse(savedTasks) as Task[];
        if (Array.isArray(parsed)) {
          const cleaned = withoutDemoTasks(parsed);
          setTasks(cleaned);
          // Replace any legacy browser snapshot that contains the old demo rows.
          if (cleaned.length !== parsed.length) {
            localStorage.setItem("campusmate-tasks", JSON.stringify(cleaned));
          }
        }
      }
    } catch { /* start with an empty list if saved data is unavailable */ }
    finally { setTasksHydrated(true); }
  }, []);

  useEffect(() => {
    if (!tasksHydrated) return;
    try { localStorage.setItem("campusmate-tasks", JSON.stringify(tasks)); } catch { /* current session still works */ }
  }, [tasks, tasksHydrated]);

  // Load saved classes/courses for the day. Authenticated users read their own
  // Supabase records; unsigned/local-demo users read the clearly browser-only
  // resource snapshot used by /resources.
  useEffect(() => {
    let cancelled = false;
    async function loadLearningSchedule() {
      try {
        const [classesResponse, coursesResponse] = await Promise.all([
          fetch("/api/class-sessions", { cache: "no-store" }),
          fetch("/api/courses", { cache: "no-store" }),
        ]);
        if (classesResponse.ok) {
          const classPayload = await classesResponse.json() as { sessions?: ResourceClassSession[] };
          const coursePayload = coursesResponse.ok ? await coursesResponse.json() as { courses?: ResourceCourse[] } : { courses: [] };
          if (!cancelled) {
            setResourceClasses(Array.isArray(classPayload.sessions) ? classPayload.sessions : []);
            setResourceCourses(Array.isArray(coursePayload.courses) ? coursePayload.courses : []);
          }
          return;
        }
      } catch { /* fall back to this browser's local demo resources */ }
      try {
        const raw = localStorage.getItem("campusmate-resources-v1");
        const snapshot = raw ? JSON.parse(raw) as { classes?: ResourceClassSession[]; courses?: ResourceCourse[] } : {};
        if (!cancelled) {
          setResourceClasses(Array.isArray(snapshot.classes) ? snapshot.classes : []);
          setResourceCourses(Array.isArray(snapshot.courses) ? snapshot.courses : []);
        }
      } catch {
        if (!cancelled) { setResourceClasses([]); setResourceCourses([]); }
      }
    }
    void loadLearningSchedule();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "campusmate-resources-v1") void loadLearningSchedule();
    };
    const onResourcesUpdated = () => void loadLearningSchedule();
    window.addEventListener("storage", onStorage);
    window.addEventListener("campusmate:resources-updated", onResourcesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("campusmate:resources-updated", onResourcesUpdated);
    };
  }, []);

  // If a Supabase session exists, load its task snapshot. Otherwise the app remains
  // fully usable in local-demo mode without requiring any environment variables.
  useEffect(() => {
    if (!tasksHydrated) return;
    let cancelled = false;
    async function connectCloudTasks() {
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { userId?: string; tasks?: Task[] };
        if (!Array.isArray(payload.tasks) || !payload.userId || cancelled) return;
        const previousCloudUser = localStorage.getItem("campusmate-cloud-user-id");
        if (payload.tasks.length > 0) {
          // Clean legacy demo rows that may already have been synced by an older build.
          setTasks(withoutDemoTasks(payload.tasks).map(task => ({ ...task, priority: normalizePriority((task as Task).priority) })));
        } else {
          // First sign-in imports the browser list, but never copies one account's local
          // tasks into a different, already-used account on the same browser.
          const startingTasks = previousCloudUser && previousCloudUser !== payload.userId ? [] : tasks;
          if (startingTasks.length === 0 && tasks.length > 0 && previousCloudUser && previousCloudUser !== payload.userId) setTasks([]);
          const seed = await fetch("/api/tasks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: startingTasks }),
          });
          if (!seed.ok) return;
        }
        if (!cancelled) {
          localStorage.setItem("campusmate-cloud-user-id", payload.userId);
          setCloudSyncEnabled(true);
          setCloudSyncStatus("synced");
        }
      } catch { /* network unavailable: keep using local storage */ }
    }
    void connectCloudTasks();
    return () => { cancelled = true; };
    // This runs after local storage hydration, then only once per page mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksHydrated]);

  useEffect(() => {
    if (!cloudSyncEnabled || !tasksHydrated) return;
    setCloudSyncStatus("syncing");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks }),
        });
        if (response.ok) setCloudSyncStatus("synced");
        else setCloudSyncStatus("error");
      } catch { setCloudSyncStatus("error"); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [tasks, tasksHydrated, cloudSyncEnabled]);

  useEffect(() => {
    // Task or saved-class edits make the planning preview stale; derive it again.
    setBriefData(null);
    setMcpDemoResult(null);
  }, [tasks, resourceClasses]);

  useEffect(() => {
    const syncSceneToLocalTime = () => {
      const hour = new Date().getHours();
      setLocalHour(hour);
      if (!customBackground) setScene(sceneForHour(hour));
    };
    syncSceneToLocalTime();
    const timer = window.setInterval(syncSceneToLocalTime, 60_000);
    return () => window.clearInterval(timer);
  }, [customBackground]);

  useEffect(() => {
    try {
      const savedImage = localStorage.getItem("campusmate-custom-background");
      const savedName = localStorage.getItem("campusmate-custom-background-name");
      if (savedImage) setCustomBackground(savedImage);
      if (savedName) setBackgroundName(savedName);
      setDarkTone(localStorage.getItem("campusmate-color-tone") === "sky-purple");
    } catch { /* local storage may be unavailable */ }
  }, []);

  function changeTone(enabled: boolean) {
    setDarkTone(enabled);
    try { localStorage.setItem("campusmate-color-tone", enabled ? "sky-purple" : "light"); } catch { /* preference remains active for this session */ }
    announce(enabled ? "Sky-purple tone enabled" : "Light tone enabled");
  }

  async function uploadBackground(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      announce("Please choose an image file");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error("Could not open image"));
          image.onload = () => {
            const maxWidth = 1920;
            const scale = Math.min(1, maxWidth / image.width);
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            const context = canvas.getContext("2d");
            if (!context) return reject(new Error("Image processing unavailable"));
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          image.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
      localStorage.setItem("campusmate-custom-background", dataUrl);
      localStorage.setItem("campusmate-custom-background-name", file.name);
      setCustomBackground(dataUrl);
      setBackgroundName(file.name);
      announce("Your background has been saved on this device");
    } catch {
      announce("That image could not be saved. Try a smaller image.");
    }
  }

  function resetBackground() {
    localStorage.removeItem("campusmate-custom-background");
    localStorage.removeItem("campusmate-custom-background-name");
    setCustomBackground(null);
    setBackgroundName("");
    setScene(sceneForHour(new Date().getHours()));
    announce("Background restored to local-time scenery");
  }

  function announce(text: string) { setToast(text); window.setTimeout(() => setToast(""), 3200); }
  function updateBatchTaskProposal(index: number, patch: Partial<ActionTaskProposal>, needsScheduleReview = false) {
    setBatchTaskProposals((current) => current.map((proposal, proposalIndex) => proposalIndex === index
      ? { ...proposal, ...patch }
      : proposal));
    if (needsScheduleReview) setBatchScheduleNeedsReview(true);
  }

  async function loadCurrentPlanningResources(): Promise<{ classes: ResourceClassSession[]; courses: ResourceCourse[] }> {
    // Refresh when planning so saved changes on /resources cannot leave stale commitments here.
    try {
      const [classResponse, courseResponse] = await Promise.all([
        fetchWithTimeout("/api/class-sessions", { cache: "no-store" }, 5_000),
        fetchWithTimeout("/api/courses", { cache: "no-store" }, 5_000),
      ]);
      if (classResponse.ok) {
        const classPayload = await classResponse.json() as { sessions?: ResourceClassSession[] };
        const coursePayload = courseResponse.ok ? await courseResponse.json() as { courses?: ResourceCourse[] } : { courses: resourceCourses };
        return {
          classes: Array.isArray(classPayload.sessions) ? classPayload.sessions : resourceClasses,
          courses: Array.isArray(coursePayload.courses) ? coursePayload.courses : resourceCourses,
        };
      }
    } catch { /* use the local browser snapshot when cloud endpoints are unavailable */ }
    try {
      const raw = localStorage.getItem("campusmate-resources-v1");
      if (raw) {
        const snapshot = JSON.parse(raw) as { classes?: ResourceClassSession[]; courses?: ResourceCourse[] };
        return {
          classes: Array.isArray(snapshot.classes) ? snapshot.classes : resourceClasses,
          courses: Array.isArray(snapshot.courses) ? snapshot.courses : resourceCourses,
        };
      }
    } catch { /* preserve the last successfully loaded resources */ }
    return { classes: resourceClasses, courses: resourceCourses };
  }

  async function recalculateBatchSchedule() {
    const latestResources = await loadCurrentPlanningResources();
    setResourceClasses(latestResources.classes);
    setResourceCourses(latestResources.courses);
    const planningClasses = latestResources.classes;
    const planningCourses = latestResources.courses;
    const occupied: Array<{ title?: string; courseId?: string | null; deadlineDate?: string | null; deadlineTime?: string | null; scheduledDate?: string; startTime?: string; endTime?: string; duration?: string; done?: boolean; kind?: string }> = tasks.map((task) => ({
      title: task.title, courseId: task.courseId, deadlineDate: task.deadlineDate, deadlineTime: task.deadlineTime,
      scheduledDate: task.scheduledDate, startTime: task.startTime, endTime: task.endTime,
      duration: task.duration, done: task.done, kind: task.kind,
    }));
    const updated = batchTaskProposals.map((proposal) => {
      const identityTasks = occupied.filter((task): task is typeof task & { title: string } => typeof task.title === "string" && Boolean(task.title.trim()));
      const duplicate = findDuplicatePlanningTask(identityTasks, proposal);
      if (duplicate) {
        const courseId = proposal.courseId ?? duplicate.courseId ?? null;
        const course = planningCourses.find((candidate) => candidate.id === courseId);
        return {
          ...proposal,
          courseId,
          courseTitle: course?.title ?? proposal.courseTitle,
          scheduledDate: "", startTime: "", endTime: "", time: "Not scheduled", canSchedule: false,
          schedulingNote: `“${duplicate.title}” already exists${duplicate.done ? " and is complete" : ""}. This batch item will be skipped to avoid a duplicate.`,
        };
      }
      const next = rescheduleTaskProposal(proposal, {
        now: new Date(), preferredStart: profilePreferredStart, preferredEnd: profilePreferredEnd,
        tasks: occupied, classes: planningClasses, courses: planningCourses,
      });
      occupied.push({
        title: next.title, courseId: next.courseId, deadlineDate: next.deadlineDate, deadlineTime: next.deadlineTime,
        scheduledDate: next.canSchedule ? next.scheduledDate : "", startTime: next.canSchedule ? next.startTime : "",
        endTime: next.canSchedule ? next.endTime : "", duration: next.duration, done: false, kind: "study",
      });
      return next;
    });
    setBatchTaskProposals(updated);
    setBatchScheduleNeedsReview(false);
    announce("Rechecked all proposed time blocks against existing tasks and classes");
  }

  async function addBatchPlanningTasks(scheduleBlocks: boolean) {
    if (!batchTaskProposals.length) return;
    if (scheduleBlocks && batchScheduleNeedsReview) {
      announce("Please recheck the proposed time blocks before scheduling the batch");
      return;
    }
    const latestResources = scheduleBlocks ? await loadCurrentPlanningResources() : { classes: resourceClasses, courses: resourceCourses };
    const currentClasses = latestResources.classes;
    if (scheduleBlocks) setResourceClasses(currentClasses);
    const toCreate: Task[] = [];
    let skippedDuplicates = 0;
    let skippedInvalid = 0;
    let scheduledCount = 0;
    let conflictedBlocks = 0;
    for (const proposal of batchTaskProposals) {
      if (!proposal.title.trim()) { skippedInvalid += 1; continue; }
      const alreadyExists = findDuplicatePlanningTask([...tasks, ...toCreate], proposal);
      if (alreadyExists) { skippedDuplicates += 1; continue; }
      const hasConflict = scheduleBlocks && proposal.canSchedule && scheduleBlockConflicts(
        proposal.scheduledDate, proposal.startTime, proposal.endTime, currentClasses, [...tasks, ...toCreate],
      );
      const shouldSchedule = scheduleBlocks && proposal.canSchedule && !hasConflict;
      if (hasConflict) conflictedBlocks += 1;
      const task: Task = {
        id: Date.now() + toCreate.length,
        title: proposal.title.trim(),
        detail: hasConflict
          ? `${proposal.detail || "Added from CampusMate batch planning"} The proposed time conflicted with a saved class or task, so this was added without a schedule block.`
          : proposal.detail || "Added from CampusMate batch planning",
        time: shouldSchedule ? proposal.time : "Not scheduled",
        duration: proposal.duration,
        priority: proposal.priority,
        done: false,
        kind: "study",
        scheduledDate: shouldSchedule ? proposal.scheduledDate : "",
        startTime: shouldSchedule ? proposal.startTime : "",
        endTime: shouldSchedule ? proposal.endTime : "",
        deadlineDate: proposal.deadlineDate,
        deadlineTime: proposal.deadlineTime,
        reminderMinutes: proposal.deadlineDate && proposal.deadlineTime ? 30 : null,
        courseId: proposal.courseId,
      };
      if (shouldSchedule) scheduledCount += 1;
      toCreate.push(task);
    }
    if (!toCreate.length) {
      setCommandOpen(false);
      announce(`No tasks created. ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? " was" : "s were"} skipped and ${skippedInvalid} blank title${skippedInvalid === 1 ? " was" : "s were"} ignored.`);
      return;
    }
    setTasks((old) => [...old, ...toCreate]);
    if (toCreate.some((task) => task.reminderMinutes !== null) && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    setTaskFilter("All");
    setCommandOpen(false);
    navigateTo(scheduleBlocks && scheduledCount > 0 ? "Schedule" : "Tasks");
    announce(`Added ${toCreate.length} task${toCreate.length === 1 ? "" : "s"}; scheduled ${scheduledCount}${conflictedBlocks ? `; ${conflictedBlocks} conflicting block${conflictedBlocks === 1 ? " was" : "s were"} added to Tasks without a time` : ""}${skippedDuplicates ? ` and skipped ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"}` : ""}${skippedInvalid ? ` and ignored ${skippedInvalid} blank title${skippedInvalid === 1 ? " was" : "s were"}` : ""}.`);
  }

  function addPlanningTask(scheduleBlock: boolean) {
    if (!taskProposal) return;
    const existing = findDuplicatePlanningTask(tasks, taskProposal);
    if (existing) {
      setTaskFilter("All");
      announce(`“${existing.title}” already exists${existing.done ? " and is marked complete" : ""}. No duplicate was created. Review or update the existing task instead.`);
      setCommandOpen(false);
      navigateTo(scheduleBlock && existing.scheduledDate ? "Schedule" : "Tasks");
      return;
    }
    const shouldSchedule = scheduleBlock && taskProposal.canSchedule;
    const task: Task = {
      id: Date.now(), title: taskProposal.title, detail: taskProposal.detail,
      time: shouldSchedule ? taskProposal.time : "Not scheduled",
      duration: taskProposal.duration, priority: taskProposal.priority, done: false, kind: "study",
      scheduledDate: shouldSchedule ? taskProposal.scheduledDate : "",
      startTime: shouldSchedule ? taskProposal.startTime : "",
      endTime: shouldSchedule ? taskProposal.endTime : "",
      deadlineDate: taskProposal.deadlineDate, deadlineTime: taskProposal.deadlineTime,
      reminderMinutes: taskProposal.deadlineDate && taskProposal.deadlineTime ? 30 : null,
      courseId: taskProposal.courseId,
    };
    setTasks((old) => [...old, task]);
    if (task.reminderMinutes !== null && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    const destination = shouldSchedule ? "Schedule" : "Tasks";
    setCommandOpen(false);
    navigateTo(destination);
    announce(shouldSchedule
      ? `Added “${task.title}” to Tasks and scheduled it for ${taskProposal.time}.`
      : `Added “${task.title}” to Tasks. You can schedule a work block anytime.`);
  }
  function updateExistingPlanningTask(scheduleBlock: boolean) {
    if (!taskProposal) return;
    const existing = findDuplicatePlanningTask(tasks, taskProposal);
    if (!existing) {
      addPlanningTask(scheduleBlock);
      return;
    }
    const shouldSchedule = scheduleBlock && taskProposal.canSchedule;
    const updatedTask: Task = {
      ...existing,
      title: taskProposal.title.trim() || existing.title,
      detail: taskProposal.detail || existing.detail,
      time: shouldSchedule ? taskProposal.time : existing.time,
      duration: taskProposal.duration || existing.duration,
      priority: taskProposal.priority,
      done: false,
      kind: "study",
      scheduledDate: shouldSchedule ? taskProposal.scheduledDate : (existing.scheduledDate || ""),
      startTime: shouldSchedule ? taskProposal.startTime : (existing.startTime || ""),
      endTime: shouldSchedule ? taskProposal.endTime : (existing.endTime || ""),
      deadlineDate: taskProposal.deadlineDate || existing.deadlineDate || "",
      deadlineTime: taskProposal.deadlineTime || existing.deadlineTime || "",
      reminderMinutes: taskProposal.deadlineDate && taskProposal.deadlineTime ? 30 : (existing.reminderMinutes ?? null),
      courseId: taskProposal.courseId ?? existing.courseId ?? null,
    };
    setTasks((old) => old.map((task) => task.id === existing.id ? updatedTask : task));
    setTaskFilter("All");
    setCommandOpen(false);
    navigateTo(shouldSchedule ? "Schedule" : "Tasks");
    announce(existing.done
      ? `Reopened and updated “${updatedTask.title}” using the new plan.`
      : `Updated the existing task “${updatedTask.title}” using the new plan.`);
  }
  function addTask() {
    if (!taskDraft.trim()) return;
    const priority = normalizePriority(taskPriorityDraft);
    const time = taskStartTimeDraft ? humanTime(taskStartTimeDraft) : taskTimeDraft;
    const duration = taskStartTimeDraft && taskEndTimeDraft ? taskDuration(taskStartTimeDraft, taskEndTimeDraft) : "30 min";
    const task: Task = { id: Date.now(), title: taskDraft.trim(), detail: taskDetailDraft.trim() || "Added just now", time, duration, priority, done: false, kind: "study", scheduledDate: taskScheduledDateDraft || "", startTime: taskStartTimeDraft, endTime: taskEndTimeDraft, deadlineDate: taskDeadlineDateDraft, deadlineTime: taskDeadlineTimeDraft, reminderMinutes: taskDeadlineDateDraft && taskDeadlineTimeDraft && taskReminderDraft >= 0 ? taskReminderDraft : null };
    setTasks(old => [...old, task]);
    if (task.reminderMinutes !== null && task.reminderMinutes !== undefined && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    resetTaskDrafts(); setAddOpen(false); announce("Added to your list");
  }
  function resetTaskDrafts() {
    setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Medium");
    setTaskScheduledDateDraft(""); setTaskStartTimeDraft(""); setTaskEndTimeDraft(""); setTaskDeadlineDateDraft(""); setTaskDeadlineTimeDraft(""); setTaskReminderDraft(30);
  }
  function beginEditTask(task: Task) {
    setEditingTaskId(task.id); setTaskDraft(task.title); setTaskDetailDraft(task.detail); setTaskTimeDraft(task.time); setTaskPriorityDraft(normalizePriority(task.priority));
    setTaskScheduledDateDraft(task.scheduledDate || ""); setTaskStartTimeDraft(task.startTime || ""); setTaskEndTimeDraft(task.endTime || "");
    setTaskDeadlineDateDraft(task.deadlineDate || ""); setTaskDeadlineTimeDraft(task.deadlineTime || ""); setTaskReminderDraft(typeof task.reminderMinutes === "number" ? task.reminderMinutes : -1); setAddOpen(true);
  }
  function removeTask(id: number) {
    setTasks(old => old.filter(task => task.id !== id));
    announce("Task removed");
  }
  function saveTaskEdit() {
    if (!taskDraft.trim() || editingTaskId === null) return;
    const time = taskStartTimeDraft ? humanTime(taskStartTimeDraft) : taskTimeDraft;
    const duration = taskStartTimeDraft && taskEndTimeDraft ? taskDuration(taskStartTimeDraft, taskEndTimeDraft) : "30 min";
    setTasks(old => old.map(task => task.id === editingTaskId ? { ...task, title: taskDraft.trim(), detail: taskDetailDraft.trim() || "No extra details", time, duration, priority: normalizePriority(taskPriorityDraft), scheduledDate: taskScheduledDateDraft || "", startTime: taskStartTimeDraft, endTime: taskEndTimeDraft, deadlineDate: taskDeadlineDateDraft, deadlineTime: taskDeadlineTimeDraft, reminderMinutes: taskDeadlineDateDraft && taskDeadlineTimeDraft && taskReminderDraft >= 0 ? taskReminderDraft : null } : task));
    if (taskDeadlineDateDraft && taskDeadlineTimeDraft && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    setEditingTaskId(null); resetTaskDrafts(); setAddOpen(false); announce("Task updated");
  }

  async function uploadProfileAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { announce("Choose an image file for your profile photo."); return; }
    if (file.size > 8 * 1024 * 1024) { announce("Please choose an image under 8 MB."); return; }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error("Could not open image."));
          image.onload = () => {
            const canvas = document.createElement("canvas"); const size = 420;
            canvas.width = size; canvas.height = size;
            const context = canvas.getContext("2d"); if (!context) return reject(new Error("Image processing isn't available."));
            const scale = Math.max(size / image.width, size / image.height);
            const width = image.width * scale; const height = image.height * scale;
            context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          image.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
      let url = dataUrl;
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const response = await fetch(dataUrl); const blob = await response.blob();
          const path = `${userData.user.id}/avatar-${Date.now()}.jpg`;
          const { error } = await supabase.storage.from("profile-avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
          if (error) throw new Error("Avatar storage isn't ready yet. Apply the profile migration in supabase/migrations and try again.");
          url = supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
        } else {
          localStorage.setItem("campusmate-profile-avatar-local", dataUrl);
        }
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("Avatar storage")) throw cause;
        try { localStorage.setItem("campusmate-profile-avatar-local", dataUrl); } catch { throw new Error("Could not save this picture in the browser."); }
      }
      setProfileAvatarUrl(url); announce("Profile picture selected. Save your profile to keep the change.");
    } catch (cause) { announce(cause instanceof Error ? cause.message : "Couldn't use that picture."); }
  }

  async function saveProfile() {
    const profile: StudentProfile = { displayName: profileName.trim() || "Student", college: profileCollege.trim(), course: profileCourse.trim(), branch: profileBranch.trim(), studyYear: profileYear.trim(), semester: profileSemester.trim(), bio: profileBio.trim(), studyGoalHours: profileGoalHours, preferredStart: profilePreferredStart, preferredEnd: profilePreferredEnd, avatarUrl: profileAvatarUrl };
    setProfileSaving(true);
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      let storageKey = "campusmate-profile-local";
      try { const supabase = createClient(); const { data } = await supabase.auth.getUser(); if (data.user) storageKey = `campusmate-profile-local:${data.user.id}`; } catch { /* unsigned/local mode */ }
      if (response.ok) {
        const payload = await response.json() as { profile?: Partial<StudentProfile> };
        const saved = { ...profile, ...(payload.profile || {}) };
        localStorage.setItem(storageKey, JSON.stringify(saved));
        announce("Profile saved to your account."); setProfileOpen(false); return;
      }
      if (response.status !== 401 && response.status !== 503) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Could not save profile. Apply the supplied Supabase migration and try again.");
      }
      localStorage.setItem(storageKey, JSON.stringify(profile));
      announce(storageKey === "campusmate-profile-local" ? "Profile saved on this device. Sign in to sync it across devices." : "Profile saved locally for this account. Apply the profile migration to enable cloud sync."); setProfileOpen(false);
    } catch (cause) {
      announce(cause instanceof Error ? cause.message : "Couldn't save your profile.");
    } finally { setProfileSaving(false); }
  }

  async function sendMessage(text = message) {
    const cleanMessage = text.trim();
    if (!cleanMessage || replyLoading) return;
    setMessage("");
    setReplyLoading(true);
    setReply("");
    try {
      const response = await fetchWithTimeout("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: cleanMessage,
          tasks: tasks.slice(0, 30),
          courses: resourceCourses.slice(0, 20),
          classes: resourceClasses.slice(0, 20),
        }),
      });
      const payload = await response.json() as { reply?: string; error?: string };
      if (!response.ok || !payload.reply) throw new Error(payload.error || "CampusMate couldn't answer right now.");
      setReply(payload.reply);
    } catch (cause) {
      setReply(friendlyRequestError(cause, "CampusMate couldn't answer right now. Check your Gemini configuration and try again."));
    } finally {
      setReplyLoading(false);
    }
  }

  async function generateIntelligenceBrief() {
    setBriefLoading(true);
    setBriefError("");
    try {
      const response = await fetchWithTimeout("/api/intelligence-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: plannerTasks, context: briefContext }),
      });
      const payload = await response.json() as { brief?: DailyBrief; error?: string };
      if (!response.ok || !payload.brief) throw new Error(payload.error || "CampusMate couldn't prepare the brief. Try again.");
      setBriefData(payload.brief);
      announce(payload.brief.engine === "ai" ? "AI-powered daily brief is ready" : "Daily brief refreshed using the planning engine");
    } catch (cause) {
      setBriefError(friendlyRequestError(cause, "The brief could not be refreshed. Your local preview is still available."));
    } finally { setBriefLoading(false); }
  }

  async function generatePlanningStudioDraft() {
    const context = planPrompt.trim() || "Help me make a realistic plan around my classes and closest deadline.";
    setPlanPrompt(context);
    setPlanLoading(true);
    setPlanError("");
    setPlanSaveError("");
    setPlanGenerated(false);
    setPlanAccepted(false);
    setPlanBrief(null);
    setTaskProposal(null);
    setBatchTaskProposals([]);
    setBatchScheduleNeedsReview(false);

    try {
      const latestResources = await loadCurrentPlanningResources();
      const planningClasses = latestResources.classes;
      const planningCourses = latestResources.courses;
      setResourceClasses(planningClasses);
      setResourceCourses(planningCourses);
      const courseContext = planningCourses.slice(0, 8).map((course) => course.course_code ? `${course.title} (${course.course_code})` : course.title).join(", ") || "none saved";
      const upcomingClasses = planningClasses
        .filter((item) => Number.isFinite(Date.parse(item.starts_at)) && Date.parse(item.starts_at) >= Date.now() - 60_000)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, 6)
        .map((item) => {
          const course = planningCourses.find((candidate) => candidate.id === item.course_id)?.title;
          const start = new Date(item.starts_at);
          return `${item.title}${course ? ` (${course})` : ""} ${start.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} ${start.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
        }).join("; ") || "none in the upcoming schedule";
      const learningContext = `Saved courses: ${courseContext}. Upcoming fixed class sessions: ${upcomingClasses}. Protect these classes from study-block overlaps; do not convert class sessions into new tasks.`.slice(0, 500);
      const response = await fetchWithTimeout("/api/intelligence-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: plannerTasks, context, learningContext }),
      });
      const payload = await response.json() as { brief?: DailyBrief; error?: string };
      if (!response.ok || !payload.brief) {
        throw new Error(payload.error || "CampusMate couldn't generate your plan. Please try again.");
      }
      setPlanBrief(payload.brief);
      setBriefData(payload.brief);
      setBriefContext(context);
      const parseOptions = {
        now: new Date(),
        preferredStart: profilePreferredStart,
        preferredEnd: profilePreferredEnd,
        tasks,
        classes: planningClasses,
        courses: planningCourses,
      };
      const extractedTasks = parseTaskIntents(context, parseOptions);
      if (extractedTasks.length > 1) {
        setTaskProposal(null);
        setBatchTaskProposals(extractedTasks);
        setBatchScheduleNeedsReview(false);
      } else {
        setBatchTaskProposals([]);
        setTaskProposal(extractedTasks[0] ?? parseTaskIntent(context, parseOptions));
      }
      setPlanGenerated(true);
      announce(payload.brief.engine === "ai"
        ? "AI-assisted Planning Studio draft generated"
        : "Planning Studio draft generated using CampusMate's rules-based engine");
    } catch (cause) {
      setPlanError(friendlyRequestError(cause, "Couldn't generate your plan. Please try again."));
    } finally {
      setPlanLoading(false);
    }
  }

  async function acceptPlanningDraft() {
    if (!planBrief || planSaving) return;

    setPlanSaving(true);
    setPlanSaveError("");

    try {
      const response = await fetch("/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_date: localDateKey,
          title: planBrief.headline,
          summary: [planBrief.summary, planBrief.reason]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 2000),
          status: "accepted",
          source: planBrief.engine === "ai" ? "ai" : "rules",
          plan_data: {
            prompt: planPrompt,
            priorityTaskId: planBrief.priorityTaskId,
            priorityTitle: planBrief.priorityTitle,
            reason: planBrief.reason,
            nextSteps: planBrief.nextSteps,
            plan: planBrief.plan,
            note: planBrief.note ?? null,
            generatedAt: planBrief.generatedAt ?? new Date().toISOString(),
          },
        }),
      });

      const payload = await response.json() as {
        plan?: { id?: string };
        error?: string;
      };

      if (!response.ok || !payload.plan) {
        throw new Error(
          payload.error || (response.status === 401
            ? "Please sign in to save this plan. Your draft is still available."
            : "CampusMate couldn't save your plan. Please try again.")
        );
      }

      setPlanAccepted(true);
      announce("Planning draft saved to your study plans");
    } catch (cause) {
      setPlanSaveError(
        cause instanceof Error
          ? cause.message
          : "CampusMate couldn't save your plan. Please try again."
      );
    } finally {
      setPlanSaving(false);
    }
  }

  async function runMcpAgentDemo() {
    setMcpDemoLoading(true);
    setMcpDemoError("");
    setMcpDemoResult(null);
    try {
      const response = await fetch("/api/mcp-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: plannerTasks, context: briefContext }),
      });
      const payload = await response.json() as McpDemoPayload;
      if (!response.ok || !payload.ok || !payload.brief) {
        throw new Error([payload.error, payload.hint].filter(Boolean).join(" ") || "The MCP client could not finish its handshake and tool calls.");
      }
      setMcpDemoResult(payload);
      setBriefData(payload.brief);
      announce("Alexa+ MCP handshake and planning tool calls succeeded");
    } catch (cause) {
      setMcpDemoError(cause instanceof Error ? cause.message : "MCP verification failed. Check the terminal for details.");
    } finally {
      setMcpDemoLoading(false);
    }
  }

  function navigateTo(label: string) {
    setMobileNav(false);
    if (label === activeNav && !routeTransition) return;
    routeTimersRef.current.forEach(clearTimeout);
    routeTimersRef.current = [];
    if (label === activeNav) {
      routeTransitionIdRef.current += 1;
      setRouteTransition(null);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      routeTransitionIdRef.current += 1;
      setActiveNav(label);
      setRouteTransition(null);
      return;
    }
    const id = routeTransitionIdRef.current + 1;
    routeTransitionIdRef.current = id;
    setRouteTransition({ phase: "cover", target: label, id });
    routeTimersRef.current.push(setTimeout(() => {
      if (routeTransitionIdRef.current !== id) return;
      setActiveNav(label);
      setRouteTransition({ phase: "reveal", target: label, id });
    }, 540));
    routeTimersRef.current.push(setTimeout(() => {
      if (routeTransitionIdRef.current === id) setRouteTransition(null);
    }, 1090));
  }

  useEffect(() => () => {
    routeTimersRef.current.forEach(clearTimeout);
  }, []);

  return <main className={`app-shell motion-on scene-${scene} ${darkTone ? "theme-sky-purple" : "theme-light"}`} style={{ "--scene-image": `url("${backgroundImage}")`, "--scene-tint": activeScene.tone } as React.CSSProperties}>
    <div className="ambient-wash" aria-hidden="true" />
    <div className="sky-effects" aria-hidden="true">
      <span className="sky-star-layer sky-star-layer-far" />
      <span className="sky-star-layer sky-star-layer-near" />
      <span className="sky-shooting-star" />
      <span className="daylight-mote-layer daylight-mote-layer-gold" />
      <span className="daylight-mote-layer daylight-mote-layer-mint" />
    </div>
    {routeTransition && <div key={routeTransition.id} className={`route-transition ${routeTransition.phase === "cover" ? "is-cover" : "is-reveal"}`} aria-hidden="true">
      <div className="transition-tile-grid">{Array.from({ length: 56 }, (_, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        const diagonal = row + col;
        return <span className="transition-tile" key={`${routeTransition.id}-${index}`} style={{ "--tile-delay": `${diagonal * 12}ms`, "--tile-reveal-delay": `${(13 - diagonal) * 10}ms`, "--tile-tone": (row + col) % 3 } as React.CSSProperties} />;
      })}</div>
      <div className="transition-caption">
        <span className="transition-orbit-mark"><i/><i/><i/><b/></span>
        <span className="transition-kicker">CAMPUSMATE · YOUR DAY, YOUR WAY</span>
        <strong>{routeTransition.target}</strong>
        <span className="transition-caption-foot">A LITTLE ROOM TO THINK <i/> {routeTransition.target.toUpperCase()}</span>
      </div>
    </div>}
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <a className="brand" href="#top" aria-label="CampusMate home"><span className="brand-symbol" aria-hidden="true"><span/><span/><span/></span><span className="brand-name">campus<span>mate</span><small>YOUR DAY, YOUR WAY</small></span></a>
      <div className="space-label">YOUR SPACE</div>
      <nav className="nav-list" aria-label="Main navigation">{nav.map((label, index) => <button key={label} className={`nav-link ${activeNav === label ? "active" : ""}`} onClick={() => navigateTo(label)}><span className="nav-number">0{index + 1}</span><span>{label}</span>{label === "Tasks" && <span className="nav-badge">{remaining}</span>}</button>)}</nav>
      <div className="sidebar-rule" />
      <a className="nav-link secondary-nav" href="/resources"><span className="nav-number">05</span><span>Courses & sessions</span></a>
      <button className="nav-link secondary-nav" onClick={() => { setCommandOpen(true); setMobileNav(false); }}><span className="nav-number">06</span><span>AI command center</span></button>
      <div className="sidebar-bottom"><div className="handwritten-note"><div className="quote-note-header"><span className="note-mark">{motivationalQuotes[quoteIndex].kicker}</span><button type="button" className="quote-refresh" aria-label="Show another motivational quote" title="Show another quote" onClick={() => { const next = (quoteIndex + 1) % motivationalQuotes.length; setQuoteIndex(next); try { localStorage.setItem("campusmate-daily-quote", JSON.stringify({ date: dateInLocalTime(new Date()), index: next })); } catch {} }}>↻</button></div><p>{motivationalQuotes[quoteIndex].text.split("\n").map((line, index) => <span key={line + index}>{index > 0 && <br/>}{line}</span>)}</p><span className="note-line"/></div>
        <button className="nav-link settings-link" onClick={() => { setSettingsOpen(true); setMobileNav(false); }}><span className="nav-number">07</span><span>Preferences</span></button>
        <button className="profile profile-open-button" onClick={() => setProfileOpen(true)} aria-label="Customize your profile"><span className="profile-pic">{profileAvatarUrl ? <img src={profileAvatarUrl} alt=""/> : profileName.charAt(0).toUpperCase()}</span><span className="profile-info"><strong>{profileName}</strong>{[profileYear, profileBranch || profileCourse].filter(Boolean).length > 0 && <span>{[profileYear, profileBranch || profileCourse].filter(Boolean).join(" · ")}</span>}</span><span className="profile-edit-glyph">↗</span></button>
      </div>
    </aside>

    <section className="main-area" id="top">
      <header className="topbar"><button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav(value => !value)}>MENU</button><div className="crumb"><span>My space</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
        <div className="top-actions"><div className="date-chip"><span>{weekday.toUpperCase()}</span><b>{dateShort}</b></div><button className="top-text-button" onClick={() => announce("Search is coming soon")}>SEARCH</button><button className="top-text-button" onClick={() => announce("You’re all caught up")}>INBOX <span className="inbox-dot"/></button><button type="button" className="tiny-avatar" onClick={() => setProfileOpen(true)} aria-label="Edit your profile" title="Edit profile">{profileAvatarUrl ? <img src={profileAvatarUrl} alt=""/> : profileName.charAt(0).toUpperCase()}</button>

        </div>
      </header>
      <div className="page-content" key={activeNav}>
        {activeNav === "Today" ? <>
        <section className="intro-row"><div className="intro-copy"><div className="eyebrow"><span className="eyebrow-dot"/> {timeLabel(localHour)} · YOUR DAILY RESET</div><h1>{greeting}<br/><em>Let’s make room.</em></h1><p>A clearer view of your day, with a little less noise around it.</p></div><div className="intro-actions"><button className="plan-day-button" onClick={() => { setCommandOpen(true); setPlanGenerated(false); setPlanAccepted(false); }}><span>↗</span> Plan my day</button><button className="add-button" onClick={() => { setEditingTaskId(null); setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Medium"); setTaskScheduledDateDraft(""); setTaskStartTimeDraft(""); setTaskEndTimeDraft(""); setTaskDeadlineDateDraft(""); setTaskDeadlineTimeDraft(""); setTaskReminderDraft(30); setAddOpen(true); }}><span>+</span> Add something</button></div></section>
        <section className="daily-glance" aria-label="Your day at a glance">
          <div className="glance-intro"><span className="section-overline">AT A GLANCE</span><strong>Today, without the noise.</strong></div>
          <div className="glance-stat"><span>OPEN TASKS</span><strong>{remaining.toString().padStart(2, "0")}</strong><small>{remaining === 1 ? "one thing at a time" : "room to make progress"}</small></div>
          <div className="glance-stat"><span>DEADLINES TODAY</span><strong>{dueTodayCount.toString().padStart(2, "0")}</strong><small>tasks due by tonight</small></div>
          <div className="glance-stat"><span>YOU’VE FINISHED</span><strong>{Math.round(doneCount / Math.max(tasks.length, 1) * 100)}<i>%</i></strong><small>{doneCount ? "progress is progress" : "start small, start anywhere"}</small></div>
        </section>
        <section className="intelligence-brief compact-intelligence" aria-labelledby="intelligence-title">
          <div className="intelligence-header compact-intelligence-header">
            <div><span className="section-overline">CAMPUSMATE / DAILY INTELLIGENCE</span><h2 id="intelligence-title">{visibleBrief.priorityTitle || visibleBrief.headline}</h2><p>{visibleBrief.summary}</p></div>
            <span className={`brief-engine ${visibleBrief.engine === "ai" ? "is-ai" : "is-rules"}`}><i />{visibleBrief.engine === "ai" ? (visibleBrief.note?.includes("Google Gemini") ? "GEMINI-ASSISTED" : "AI-ASSISTED") : "PLANNING ENGINE"}</span>
          </div>
          <div className="compact-intelligence-bottom"><p>{visibleBrief.reason}</p><div><button className="brief-generate" onClick={generateIntelligenceBrief} disabled={briefLoading}>{briefLoading ? <><i className="brief-spinner"/> THINKING…</> : <>Refresh <span>↗</span></>}</button><button className="brief-open-tasks" onClick={() => { setCommandOpen(true); setPlanGenerated(false); setPlanAccepted(false); }}>Open AI Study Planner <span>↗</span></button></div></div>
          <details className="intelligence-details"><summary>See full daily analysis and MCP tools</summary>
            <div className="intelligence-grid"><div className="brief-priority"><span className="brief-label">YOUR NEXT BEST MOVE</span><h3>{visibleBrief.priorityTitle}</h3><p>{visibleBrief.reason}</p><button className="brief-open-tasks" onClick={() => navigateTo("Tasks")}>Review my task list <span>↗</span></button></div><div className="brief-steps"><span className="brief-label">THREE GOOD NEXT STEPS</span><ol>{visibleBrief.nextSteps.map((step,index)=><li key={`${index}-${step}`}><span>0{index+1}</span><p>{step}</p></li>)}</ol></div></div>
            <div className="brief-plan"><div className="brief-plan-heading"><span className="brief-label">A FLEXIBLE FIRST DRAFT</span><span>NOTHING CHANGES UNTIL YOU DO</span></div><div className="brief-plan-items">{visibleBrief.plan.map((item,index)=><article className="brief-plan-item" key={`${item.title}-${index}`}><span className="brief-plan-time">{item.time}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div></div>
            <div className="brief-controls"><label className="brief-context"><span>ANYTHING CAMPUSMATE SHOULD CONSIDER?</span><input value={briefContext} onChange={event=>{setBriefContext(event.target.value);setBriefData(null);setMcpDemoResult(null)}} maxLength={300} placeholder="Low energy, an exam coming up, or a plan change…"/></label><div className="brief-control-actions"><button className="brief-generate" onClick={generateIntelligenceBrief} disabled={briefLoading}>{briefLoading?"THINKING…":"Refresh intelligence ↗"}</button><button className="mcp-demo-button" onClick={runMcpAgentDemo} disabled={mcpDemoLoading}>{mcpDemoLoading?"CHECKING MCP…":"Run Alexa+ MCP test ↗"}</button></div></div>
            {mcpDemoResult && <div className="mcp-demo-result" role="status"><div className="mcp-demo-indicator"><i/> STREAMABLE HTTP · CONNECTED</div><p><strong>{mcpDemoResult.calls?.length ?? 0} real tool calls completed.</strong> {mcpDemoResult.calls?.join(" → ")}. {mcpDemoResult.openTaskCount ?? "—"} open tasks inspected via the MCP client. Provider: {mcpDemoResult.provider ?? "CampusMate planner"}.</p><small>Protocol: {mcpDemoResult.protocol ?? "negotiated"} · Server: {mcpDemoResult.server?.name ?? "campusmate-ai"} {mcpDemoResult.server?.version ?? ""}</small></div>}
            {mcpDemoError && <p className="brief-error" role="alert">MCP test failed: {mcpDemoError}</p>}
            <div className="brief-footnote"><span>{briefData?.note ?? "Rules-based planning works without cloud credentials. Bedrock is used only when enabled and the model call succeeds."}</span><span>{briefData?.generatedAt ? `UPDATED ${new Date(briefData.generatedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : "LIVE PREVIEW FROM YOUR CURRENT TASKS"}</span></div>
          </details>
          {briefError && <p className="brief-error" role="alert">{briefError}</p>}
        </section>
        <div className="dashboard-layout"><div className="left-stack">
          <section className="next-card"><div className="next-card-top"><span className="micro-label"><span className="live-dot"/> A GOOD PLACE TO START</span><span className="card-index">01 <span>/ 03</span></span></div>
            <div className="next-card-body"><div className="next-copy"><div className="task-kicker">{nextTask ? nextTask.kind === "class" ? "ON YOUR TIMETABLE" : nextTask.kind === "life" ? "MAKE ROOM FOR YOU" : "A SMALL ACADEMIC WIN" : "A MOMENT TO YOURSELF"}</div><h2>{nextTask ? nextTask.title : "You’ve cleared the list."}</h2><p>{nextTask ? `Start with “${nextTask.title}”. ${nextTask.detail}. A little progress now can make the rest of the day feel lighter.` : "Your open loops are closed for now. Take a proper break, or add something new when you’re ready."}</p><div className="next-meta"><span>{nextTask ? nextTask.time : "No task waiting"}</span><span className="meta-divider"/><span>{nextTask ? nextTask.duration : "Take a breath"}</span></div><div className="next-actions"><button className="start-button" onClick={() => { setFocusOn(value => !value); announce(focusOn ? "Focus session paused" : "Focus session started"); }}>{focusOn ? "FOCUS SESSION ACTIVE" : "START A FOCUS SESSION"}<span>↗</span></button><button className="quiet-button" onClick={() => sendMessage("Can you suggest another task for me?")}>Not feeling this <span>↘</span></button></div></div>
              <div className="progress-art"><div className="paper-note note-a"><span>FIELD NOTE / 01</span><strong>Small steps<br/>still count.</strong><i>— a reminder</i></div><div className="progress-stamp"><svg viewBox="0 0 120 120" role="img" aria-label="70 percent complete"><circle cx="60" cy="60" r="48"/><circle className="progress-value" cx="60" cy="60" r="48" style={{ strokeDashoffset: 301.6 - (doneCount / Math.max(tasks.length, 1)) * 301.6 }}/></svg><div><strong>{Math.round(doneCount / Math.max(tasks.length, 1) * 100)}<small>%</small></strong><span>COMPLETE</span></div></div><div className="orbit-caption">CURRENT MOMENT <span>·</span> 35 MIN</div></div>
            </div><div className="next-card-foot"><div className="why-mark">WHY THIS, NOW?</div><div><strong>{nextTask ? nextTask.priority === "High" ? "Give this your attention first." : nextTask.priority === "Medium" ? "A useful next step, at your pace." : "A gentle place to begin." : "Nothing urgent is asking for you."}</strong><span>{nextTask ? "Keep the next step small, then reassess. You don’t have to solve the whole day at once." : "Enjoy the breathing room, or make a fresh plan when you need one."}</span></div><button onClick={() => { setPlanPrompt(nextTask ? `Help me fit “${nextTask.title}” into my day. ${nextTask.detail}.` : "Help me plan a balanced day with study, breaks and personal time."); setPlanGenerated(false); setPlanAccepted(false); setCommandOpen(true); }}>Talk it through <span>↗</span></button></div>
          </section>
          <section className="schedule-section"><div className="section-title-row"><div><span className="section-overline">THE SHAPE OF TODAY</span><h3>Your day, in pieces <span className="date-small">{weekday.slice(0, 3).toUpperCase()} · {today.getDate().toString().padStart(2, "0")}</span></h3></div><button className="text-link" onClick={() => navigateTo("Schedule")}>See full schedule <span>↗</span></button></div>
            <div className="schedule-card">{scheduleEntries.length ? scheduleEntries.slice(0, 3).map((entry, index, visible) => {
              const match = entry.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
              const startLabel = entry.startTime ? humanTime(entry.startTime) : entry.time;
              const endLabel = entry.endTime ? humanTime(entry.endTime) : "";
              const startPeriod = startLabel.match(/\s(AM|PM)$/i)?.[1]?.toUpperCase();
              const endPeriod = endLabel.match(/\s(AM|PM)$/i)?.[1]?.toUpperCase();
              const compactRange = Boolean(endLabel && startPeriod && startPeriod === endPeriod);
              const timeMain = compactRange
                ? `${startLabel.replace(/\s(?:AM|PM)$/i, "")}–${endLabel.replace(/\s(?:AM|PM)$/i, "")}`
                : match ? `${Number(match[1])}:${match[2]}` : "FLEX";
              const period = compactRange ? endPeriod : match?.[3]?.toUpperCase() ?? "";
              const periodLabel = endLabel && !compactRange ? `${period ? `${period} · ` : ""}TO ${endLabel}` : period;
              const duration = entry.duration.replace(/\bmin(?:ute)?s?\b/i, "MIN").replace(/\bhr(?:s)?\b/i, "HOUR").replace(/\bhours?\b/i, "HOUR").toUpperCase();
              return <div className={`schedule-row ${entry.done ? "completed" : index === 0 ? "up-next" : ""} ${index === visible.length - 1 ? "last-event" : ""}`} key={entry.key}>
                <div className={`schedule-time ${endLabel ? "has-time-range" : ""}`}>{timeMain}{periodLabel && <small>{periodLabel}</small>}</div>
                <div className="schedule-track"><span className="track-node">{String(index + 1).padStart(2, "0")}</span>{index < visible.length - 1 && <span className="track-stem"/>}</div>
                <div className="schedule-detail"><strong>{entry.title}{index === 0 && !entry.done && <b>UP NEXT</b>}</strong><span>{entry.detail || (entry.kind === "class" ? "Fixed class commitment" : "A small step in your day")}</span></div>
                <span className="event-length">{duration || "FLEX"}</span>
              </div>;
            }) : <div className="schedule-row last-event"><div className="schedule-time">OPEN</div><div className="schedule-track"><span className="track-node">01</span></div><div className="schedule-detail"><strong>No schedule items yet.</strong><span>Add a task or class to give the day a little shape.</span></div><span className="event-length">FLEX</span></div>}</div>
          </section>
          <section className="tasks-section"><div className="section-title-row"><div><span className="section-overline">THE OPEN LOOPS</span><h3>Next up <span className="count-pill">{remaining} LEFT</span></h3></div><button className="text-link" onClick={() => navigateTo("Tasks")}>All tasks <span>↗</span></button></div>
            <div className="tasks-card">{tasks.filter(task => !task.done).slice(0, 3).map((task, index) => <div className={`task-row ${task.done ? "task-is-done" : ""}`} key={task.id}><button className={`task-check ${task.done ? "checked" : ""}`} aria-label={task.done ? "Mark as not done" : "Mark as done"} onClick={() => setTasks(old => old.map(item => item.id === task.id ? { ...item, done: !item.done } : item))}>{task.done ? "✓" : ""}</button><span className="task-number">0{index + 1}</span><div className="task-main"><strong>{task.title}</strong><span>{[task.courseId ? resourceCourses.find((course) => course.id === task.courseId)?.title : "", task.detail].filter(Boolean).join(" · ")}</span>{task.deadlineDate && <small className="task-deadline-inline">DUE {new Date(`${task.deadlineDate}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}{task.deadlineTime ? ` · ${humanTime(task.deadlineTime)}` : ""}</small>}</div><span className={`priority-tag ${task.priority.toLowerCase()}`}>{task.priority}</span><div className="task-time"><strong>{task.time}</strong><span>{task.duration}</span></div><button className="row-more" aria-label={`Options for ${task.title}`} onClick={() => announce(`Options for ${task.title}`)}>•••</button></div>)}</div>
          </section>
        </div>
        <aside className="right-stack">
          <section className="week-card"><div className="side-card-heading"><div><span className="section-overline">A QUICK CHECK-IN</span><h3>Your week, as it is.</h3></div><span className="week-index">YOUR PACE</span></div><p className="week-copy">{remaining ? `${remaining} open item${remaining === 1 ? "" : "s"} to work through. Keep fixed classes protected and let flexible work move when life does.` : "Your open task list is clear. Leave a little room for rest and the unexpected."}</p><div className="week-meter"><div className="meter-top"><span>Task completion</span><strong>{completionRate}% <small>of list</small></strong></div><div className="meter-track"><span style={{ width: `${completionRate}%` }}/></div><div className="meter-legend"><span><i className="dot-study"/> Completed</span><span><i className="dot-rest"/> Still open</span></div></div><div className="week-bottom"><div><strong>{compactMinutes(estimatedOpenMinutes)}</strong><span>open task estimate</span></div><div><strong>{dueTodayCount}</strong><span>deadlines today</span></div><div><strong>{classSessionsToday.length}</strong><span>classes today</span></div></div></section>
          <button type="button" className="show-more-today" onClick={() => setShowExtraToday(value => !value)}>{showExtraToday ? "Show less" : "More from CampusMate"} <span>{showExtraToday ? "−" : "+"}</span></button>
          {showExtraToday && <div className="extra-today-content">
          <section className="note-card"><div className="note-card-top"><div><span className="section-overline">A NOTE FROM CAMPUSMATE</span><strong>One thing worth knowing</strong><span className="note-status">HERE IF YOU NEED A HAND</span></div><span className="note-index">NOTE 01</span></div><p>{nextTask ? `“${nextTask.title}” is still on your list${nextTask.deadlineDate === localDateKey ? " and due today" : ""}. Keep the first step small, then reassess rather than trying to solve the whole day at once.` : "Your open task list is clear. You can leave the time open, or take two minutes to look at tomorrow."}</p><button className="note-action" onClick={() => sendMessage(nextTask ? `Help me fit “${nextTask.title}” into today` : "Help me make a balanced plan for tomorrow")}>{nextTask ? "Fit it into my day" : "Look at tomorrow"} <span>↗</span></button></section>
          <section className="chat-card"><div className="chat-heading"><div className="companion-heading"><span className="companion-orb" aria-hidden="true"><span/><span/><span/></span><div><span className="section-overline">A LITTLE HELP, WHEN YOU NEED IT</span><strong>Talk it through</strong><span>No perfect plan required.</span></div></div><span className="chat-presence">HERE</span></div><div className="prompt-list"><button onClick={() => sendMessage("What should I focus on next?")}>What should I do next? <span>↗</span></button><button onClick={() => sendMessage("Help me rebalance my day")}>I’m running behind <span>↗</span></button><button onClick={() => sendMessage("Do I have enough time today?")}>Is my day too full? <span>↗</span></button></div>{(replyLoading || reply) && <div className="chat-reply"><span>{replyLoading ? "CAMPUSMATE IS THINKING…" : "YOUR PLANNER SAYS"}</span><p>{replyLoading ? "Checking your saved planner context…" : reply}</p></div>}<form className="chat-form" onSubmit={event => { event.preventDefault(); sendMessage(); }}><input id="ask-campusmate" value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell me what’s changed…" aria-label="Message CampusMate"/><button disabled={!message.trim() || replyLoading} aria-label="Send message">{replyLoading ? "…" : "SEND"} <span>↗</span></button></form><span className="chat-footnote">A suggestion, not a command.</span></section>
          <section className="small-progress"><div className="progress-head"><span>TODAY SO FAR</span><strong>{doneCount} OF {tasks.length}</strong></div><div className="progress-bar"><span style={{ width: `${doneCount / Math.max(tasks.length, 1) * 100}%` }}/></div><p>{doneCount === 0 ? "No need to sprint. Start wherever you are." : doneCount === tasks.length ? "Everything on this list is done. Take a breath." : "A few things off your mind already."}</p></section>
          </div>}
        </aside></div>
        <section className="compact-resource-preview"><div className="compact-resource-heading"><div><span className="section-overline">YOUR LEARNING SPACE</span><h3>Courses and campus, close by.</h3><p>Pick up where your classes and study sessions leave off.</p></div><a href="/resources" className="text-link">Open full library ↗</a></div><div className="compact-resource-grid"><article><span className="resource-preview-label">SAVED COURSES</span><strong>{resourceCourses.length}</strong><div className="resource-chip-list">{resourceCourses.slice(0,3).map(course=><span key={course.id}>{course.title}</span>)}{resourceCourses.length===0 && <span>No courses yet</span>}</div></article><article><span className="resource-preview-label">NEXT CLASS</span><strong>{classSessionsToday[0]?.title ?? "Nothing scheduled"}</strong><p>{classSessionsToday[0] ? `${new Date(classSessionsToday[0].starts_at).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}${classSessionsToday[0].location ? ` · ${classSessionsToday[0].location}` : ""}` : "Add lectures and labs to keep your day in one place."}</p></article><article><span className="resource-preview-label">QUICK ACTION</span><strong>Keep your material together</strong><p>Manage courses, sessions, saved plans and focus time in one workspace.</p><a href="/resources" className="text-link">Manage resources ↗</a></article></div></section>
        </> : <section className="planner-page">
          <div className="planner-hero"><div><span className="section-overline">CAMPUSMATE / YOUR PLANNER</span><h1>{activeNav === "Tasks" ? <>Make space<br/><em>for what matters.</em></> : activeNav === "Schedule" ? <>A day with<br/><em>a little structure.</em></> : activeNav === "My week" ? <>The week ahead,<br/><em>at your pace.</em></> : <>Your campus,<br/><em>in one place.</em></>}</h1><p>{activeNav === "Tasks" ? "A flexible list for the things you want to move forward." : activeNav === "Schedule" ? "Your commitments and focus blocks, gathered in one clear timeline." : activeNav === "My week" ? "A gentle overview of what is done, what is next, and where you have room." : "Keep the places and classes that shape your week close at hand."}</p></div><button className="plan-day-button" onClick={() => { setEditingTaskId(null); setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Medium"); setTaskScheduledDateDraft(""); setTaskStartTimeDraft(""); setTaskEndTimeDraft(""); setTaskDeadlineDateDraft(""); setTaskDeadlineTimeDraft(""); setTaskReminderDraft(30); setAddOpen(true); }}>＋ Add a task</button></div>
          {activeNav === "Tasks" && <>
            <div className="planner-summary"><div><span>OPEN</span><strong>{remaining.toString().padStart(2,"0")}</strong><small>still in progress</small></div><div><span>HIGH PRIORITY</span><strong>{highPriorityCount.toString().padStart(2,"0")}</strong><small>needs more attention</small></div><div><span>COMPLETED</span><strong>{doneCount.toString().padStart(2,"0")}</strong><small>small wins count</small></div></div>
            <div className="planner-toolbar"><div className="planner-tabs">{(["All","Open","Done"] as const).map(filter => <button key={filter} className={taskFilter === filter ? "selected" : ""} onClick={() => setTaskFilter(filter)}>{filter}<span>{filter === "All" ? tasks.length : filter === "Open" ? remaining : doneCount}</span></button>)}</div><span className="planner-hint">{cloudSyncEnabled ? (cloudSyncStatus === "syncing" ? "SYNCING TO CLOUD…" : cloudSyncStatus === "synced" ? "CLOUD SYNC ON" : "SYNC NEEDS ATTENTION") : "SAVED ON THIS DEVICE"}</span></div>
            <div className="planner-task-list">{tasks.filter(task => taskFilter === "All" || (taskFilter === "Open" ? !task.done : task.done)).map((task,index) => <article className={`planner-task ${task.done ? "is-done" : ""}`} key={task.id}><button className={`task-check ${task.done ? "checked" : ""}`} aria-label={task.done ? "Mark as open" : "Complete task"} onClick={() => setTasks(old => old.map(item => item.id === task.id ? {...item,done:!item.done}:item))}>{task.done ? "✓" : ""}</button><span className="planner-task-index">{String(index+1).padStart(2,"0")}</span><div className="planner-task-copy"><strong>{task.title}</strong><span>{task.detail}</span><div className="planner-task-meta"><span>{task.scheduledDate ? new Date(`${task.scheduledDate}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : task.time}</span>{task.startTime && task.endTime && <span className="task-time-range">{formatScheduleTimeRange(task.startTime, task.endTime)}</span>}<span>{task.duration}</span>{task.courseId && resourceCourses.find((course) => course.id === task.courseId) && <span className="task-course-inline">{resourceCourses.find((course) => course.id === task.courseId)?.title}</span>}{task.deadlineDate && <span className="task-deadline-inline">DUE {new Date(`${task.deadlineDate}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}{task.deadlineTime ? ` · ${humanTime(task.deadlineTime)}` : ""}</span>}<span className={`priority-tag ${task.priority.toLowerCase()}`}>{task.priority}</span></div></div><div className="planner-task-actions"><button onClick={() => beginEditTask(task)}>EDIT</button><button onClick={() => removeTask(task.id)}>REMOVE</button></div></article>)}{tasks.filter(task => taskFilter === "All" || (taskFilter === "Open" ? !task.done : task.done)).length === 0 && <div className="planner-empty"><span className="section-overline">A CLEAR PATCH OF SKY</span><h3>Nothing here for now.</h3><p>Enjoy the breathing room, or add something when it comes to mind.</p><button className="start-button" onClick={() => {setEditingTaskId(null);setTaskDraft("");setAddOpen(true)}}>Add a task <span>↗</span></button></div>}</div>
          </>}
          {activeNav === "Schedule" && <div className="planner-timeline-card"><div className="timeline-heading"><div><span className="section-overline">TODAY · {weekday.toUpperCase()}</span><h3>Everything has a place.</h3></div><span>{scheduleEntries.length} ITEMS</span></div>{scheduleEntries.map((entry,index)=>{const task=tasks.find(item=>`task-${item.id}`===entry.key);return <div className={`planner-event ${entry.done?"is-done":""} ${scheduleConflictKeys.has(entry.key) ? "schedule-conflict" : ""}`} key={entry.key}><div className="planner-event-time">{entry.time === "Not scheduled" ? "FLEX" : formatScheduleTimeRange(entry.startTime, entry.endTime, entry.time)}</div><div className="planner-event-rail"><span>{String(index+1).padStart(2,"0")}</span><i/></div><div className="planner-event-body"><strong>{entry.title}</strong><span>{entry.detail || (entry.kind === "class" ? "Fixed class commitment" : "A small step in your day")}</span><small>{entry.duration} · {entry.kind === "class" ? "FIXED COMMITMENT" : task?.priority.toUpperCase() ?? "SCHEDULED"}{scheduleConflictKeys.has(entry.key) && <span className="schedule-conflict-label">TIME CONFLICT</span>}</small></div>{task && <><button className={`task-check ${task.done ? "checked" : ""}`} onClick={() => setTasks(old => old.map(item => item.id===task.id?{...item,done:!item.done}:item))} aria-label="Toggle completion">{task.done?"✓":""}</button><button className="event-edit" onClick={() => beginEditTask(task)}>EDIT</button></>}</div>})}{scheduleEntries.length===0 && <div className="planner-empty"><h3>A clear stretch of time.</h3><p>Add a task or a class to give today a little shape.</p></div>}<div className="timeline-bottom-note">{cloudSyncEnabled ? "Planner tasks sync to your account; saved class sessions are read from your learning space." : "Planner tasks stay on this device. Saved classes from your learning space appear here when available."}</div></div>}
          {activeNav === "Schedule" && <section className="schedule-campus-notes"><div className="section-title-row"><div><span className="section-overline">BEYOND THE TIMELINE</span><h3>Classes & campus notes</h3></div><a className="text-link" href="/resources">Manage classes ↗</a></div><div className="week-overview-grid"><article className="week-overview-card"><span className="section-overline">NEXT SAVED CLASS</span><h3>{classSessionsToday[0]?.title ?? "No class saved yet."}</h3><p>{classSessionsToday[0] ? `${resourceCourses.find((course) => course.id === classSessionsToday[0].course_id)?.title ?? "Independent class"}${classSessionsToday[0].location ? ` · ${classSessionsToday[0].location}` : ""}\n${new Date(classSessionsToday[0].starts_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} – ${new Date(classSessionsToday[0].ends_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Add a lecture or lab to connect your class commitments to today's planner."}</p><span className="class-chip">{classSessionsToday.length ? `${classSessionsToday.length} TODAY` : "READY WHEN YOU ARE"}</span></article><article className="week-overview-card"><span className="section-overline">STUDY SPACE</span><h3>Find a quiet corner.</h3><p>Choose a familiar place, keep your essentials close, and protect a focused block between classes.</p><span className="class-chip">STUDY RITUAL</span></article><article className="week-overview-card"><span className="section-overline">YOUR LEARNING SPACE</span><h3>{resourceCourses.length} course{resourceCourses.length === 1 ? "" : "s"} saved</h3><p>Classes you add in Courses & sessions can be included in today's timeline and planning brief.</p><a className="text-link" href="/resources">Open learning space ↗</a></article></div></section>}
          {activeNav === "My week" && <div className="week-overview-grid"><article className="week-overview-card week-overview-feature"><span className="section-overline">A VIEW OF YOUR WEEK</span><strong>{Math.round(doneCount / Math.max(tasks.length,1)*100)}<small>%</small></strong><h3>Progress, not perfection.</h3><p>{doneCount} of {tasks.length} items completed. Keep the plan flexible and make room for rest.</p><div className="progress-bar"><span style={{width:`${doneCount / Math.max(tasks.length,1)*100}%`}}/></div></article><article className="week-overview-card"><span className="section-overline">COMING UP</span><strong>{remaining.toString().padStart(2,"0")}</strong><h3>Things still in motion</h3><p>{tasks.filter(task=>!task.done).slice(0,3).map(task=>task.title).join(" · ") || "Nothing urgent. Enjoy the space."}</p><button className="text-link" onClick={()=>navigateTo("Tasks")}>Open task list ↗</button></article><article className="week-overview-card"><span className="section-overline">A SMALL REMINDER</span><h3>Leave room for the unexpected.</h3><p>A useful plan is one you can adapt. Protect fixed commitments, and let flexible blocks move when life does.</p><button className="text-link" onClick={()=>setCommandOpen(true)}>Plan with CampusMate ↗</button></article></div>}
        </section>}
        <footer className="page-footer"><span>Made for the full life outside your to-do list.</span><span>CampusMate <i/> A little more room to think.</span><button onClick={() => announce("Thanks — feedback helps us make this better.")}>Leave a thought <span>↗</span></button></footer>
      </div>
    </section>
    {commandOpen && <div className="modal-scrim command-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-modal" role="dialog" aria-modal="true" aria-labelledby="command-title"><button className="modal-x" onClick={() => setCommandOpen(false)} aria-label="Close AI command center">CLOSE</button><div className="command-kicker"><span className="command-pulse"/> CAMPUSMATE / PLANNING STUDIO</div><h2 id="command-title">Let’s make room<br/><em>for your real life.</em></h2><p className="command-intro">Tell me what’s on your plate. I’ll shape a draft around your fixed commitments, energy, and deadlines.</p><label className="command-label" htmlFor="plan-prompt">WHAT DOES TODAY LOOK LIKE?</label><textarea id="plan-prompt" value={planPrompt} onChange={event => { setPlanPrompt(event.target.value); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setTaskProposal(null); setBatchTaskProposals([]); setBatchScheduleNeedsReview(false); }} placeholder="List several tasks: finish Physics by 10 PM today, practice DSA for an hour tomorrow, and complete Calculus by Sunday…" rows={3}/><div className="command-chips"><button onClick={() => { setPlanPrompt("I’m running behind. Help me protect my classes and finish the most urgent assignment."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setTaskProposal(null); setBatchTaskProposals([]); setBatchScheduleNeedsReview(false); }}>I’m running behind</button><button onClick={() => { setPlanPrompt("Help me balance study time, proper breaks, and a little exercise today."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setTaskProposal(null); setBatchTaskProposals([]); setBatchScheduleNeedsReview(false); }}>Balance study & life</button><button onClick={() => { setPlanPrompt("I have an assignment due tomorrow and need a realistic plan around my lectures."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setTaskProposal(null); setBatchTaskProposals([]); setBatchScheduleNeedsReview(false); }}>Deadline tomorrow</button><button onClick={() => { setPlanPrompt("I need to finish my Applied Physics assignment by 10 PM today. It will take around two hours. Practice DSA for an hour tomorrow, and complete my Calculus problems by Sunday."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setTaskProposal(null); setBatchTaskProposals([]); setBatchScheduleNeedsReview(false); }}>Plan several tasks</button></div>{!planGenerated ? (
              <button
                className="command-generate"
                onClick={() => { void generatePlanningStudioDraft(); }}
                disabled={planLoading}
              >
                {planLoading ? <><i className="brief-spinner" /> BUILDING YOUR PLAN…</> : <>Build my day <span>↗</span></>}
              </button>
            ) : planBrief ? (
              <div className="generated-plan">
                <div className="generated-plan-head">
                  <div>
                    <span className="section-overline">YOUR PLANNING DRAFT</span>
                    <h3>{planBrief.headline}</h3>
                  </div>
                  <span className="draft-badge">{planBrief.engine === "ai" ? (planBrief.note?.includes("Google Gemini") ? "GEMINI-ASSISTED" : "AI-ASSISTED") : "RULES-BASED"}</span>
                </div>
                <p className="plan-disclaimer">{planBrief.summary}</p>
                <p className="plan-disclaimer">{planBrief.reason}</p>
                {batchTaskProposals.length > 1 ? (
                  <section className="command-batch-proposal" aria-label="Review multiple task proposals">
                    <div className="command-batch-heading">
                      <span className="section-overline">BATCH PLANNING · REVIEW BEFORE SAVING</span>
                      <h4>{batchTaskProposals.length} tasks found in your request</h4>
                      <p>Edit any title, deadline, duration, or course association. CampusMate checks existing tasks and reserves each proposed work block before offering the next one.</p>
                    </div>
                    <div className="command-batch-list">
                      {batchTaskProposals.map((proposal, index) => {
                        const duplicate = findDuplicatePlanningTask(tasks, proposal);
                        return (
                          <article className={`command-batch-item ${duplicate ? "is-duplicate" : ""}`} key={`${proposal.title}-${index}`}>
                            <div className="command-batch-item-top">
                              <span className="section-overline">TASK {String(index + 1).padStart(2, "0")}</span>
                              {duplicate ? <span className="command-batch-duplicate">EXISTING TASK · WILL SKIP</span> : <span className="command-batch-status">{proposal.canSchedule && !batchScheduleNeedsReview ? "TIME FOUND" : batchScheduleNeedsReview ? "RECHECK TIME" : "TASK ONLY"}</span>}
                            </div>
                            <label className="command-batch-label">TASK TITLE
                              <input className="command-batch-input" value={proposal.title} maxLength={180} onChange={(event) => updateBatchTaskProposal(index, { title: event.target.value })} />
                            </label>
                            <div className="command-batch-fields">
                              <label className="command-batch-label">DEADLINE DATE
                                <input className="command-batch-input" type="date" value={proposal.deadlineDate} onChange={(event) => updateBatchTaskProposal(index, { deadlineDate: event.target.value, canSchedule: false, scheduledDate: "", startTime: "", endTime: "", time: "Not scheduled", schedulingNote: "Deadline changed. Recheck the proposed time before scheduling." }, true)} />
                              </label>
                              <label className="command-batch-label">DEADLINE TIME
                                <input className="command-batch-input" type="time" value={proposal.deadlineTime} onChange={(event) => updateBatchTaskProposal(index, { deadlineTime: event.target.value, deadlineDate: proposal.deadlineDate || dateInLocalTime(new Date()), canSchedule: false, scheduledDate: "", startTime: "", endTime: "", time: "Not scheduled", schedulingNote: "Deadline changed. Recheck the proposed time before scheduling." }, true)} />
                              </label>
                              <label className="command-batch-label">ESTIMATED MINUTES
                                <input className="command-batch-input" type="number" min={15} max={480} step={15} value={proposal.durationMinutes} onChange={(event) => {
                                  const minutes = Math.max(15, Math.min(480, Number(event.target.value) || 15));
                                  const duration = minutes % 60 === 0 ? `${minutes / 60} hr${minutes === 60 ? "" : "s"}` : minutes > 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
                                  updateBatchTaskProposal(index, { durationMinutes: minutes, duration, durationEstimated: false, canSchedule: false, scheduledDate: "", startTime: "", endTime: "", time: "Not scheduled", schedulingNote: "Duration changed. Recheck the proposed time before scheduling." }, true);
                                }} />
                              </label>
                            </div>
                            <div className="command-course-link-field command-batch-course">
                              <label htmlFor={`batch-course-${index}`}>LINK TO COURSE</label>
                              <select id={`batch-course-${index}`} value={proposal.courseId ?? ""} onChange={(event) => {
                                const course = resourceCourses.find((candidate) => candidate.id === event.target.value);
                                updateBatchTaskProposal(index, { courseId: course?.id ?? null, courseTitle: course?.title ?? null });
                              }}>
                                <option value="">General task — no course</option>
                                {resourceCourses.map((course) => <option key={course.id} value={course.id}>{course.title}{course.course_code ? ` · ${course.course_code}` : ""}</option>)}
                              </select>
                            </div>
                            <div className="command-batch-schedule-line">
                              <strong>{duplicate ? "Existing task · no new block will be created" : proposal.canSchedule && !batchScheduleNeedsReview ? `${proposal.scheduledDate} · ${proposal.time}–${humanTime(proposal.endTime)}` : batchScheduleNeedsReview ? "Recheck needed after edits" : "No conflict-free block found"}</strong>
                              <span>{proposal.duration}{proposal.durationEstimated ? " · estimated" : ""}{proposal.deadlineDate ? ` · due ${proposal.deadlineDate}${proposal.deadlineTime ? ` ${humanTime(proposal.deadlineTime)}` : ""}` : " · no deadline"}</span>
                            </div>
                            {duplicate && <p className="command-batch-duplicate-note">“{duplicate.title}” already exists{duplicate.done ? " and is complete" : ""}. Batch creation will skip this item to prevent a duplicate.</p>}
                          </article>
                        );
                      })}
                    </div>
                    <div className="command-batch-actions">
                      <button type="button" className="quiet-button" onClick={recalculateBatchSchedule}>Recheck all times</button>
                      <button type="button" className="start-button" disabled={batchScheduleNeedsReview} onClick={() => addBatchPlanningTasks(true)}>Create all tasks & schedule available blocks <span>↗</span></button>
                      <button type="button" className="quiet-button" onClick={() => addBatchPlanningTasks(false)}>Add all to Tasks only</button>
                    </div>
                    <p className="command-batch-footnote">Existing duplicates are skipped. Tasks with no conflict-free time can still be added to Tasks without a schedule block. Nothing is saved until you choose an action above.</p>
                  </section>
                ) : (
                <section className="command-task-proposal" aria-label="Task detected from your request">
                  <div className="command-task-proposal-heading">
                    <span className="section-overline">TURN YOUR REQUEST INTO ACTION</span>
                    <strong>{taskProposal ? taskProposal.title : "No specific task detected yet"}</strong>
                    <p>{taskProposal ? "Review the task details and approve whether CampusMate should place a work block on your schedule." : "Try a concrete request, such as ‘Finish my physics assignment by 10 PM today; it will take two hours.’ General planning prompts stay as suggestions."}</p>
                  </div>
                  {taskProposal && <>
                    <div className="command-task-proposal-meta">
                      <div><span>DEADLINE</span><strong>{taskProposal.deadlineDate ? new Date(`${taskProposal.deadlineDate}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "Not specified"}{taskProposal.deadlineTime ? ` · ${humanTime(taskProposal.deadlineTime)}` : ""}</strong></div>
                      <div><span>WORK BLOCK</span><strong>{taskProposal.duration}{taskProposal.durationEstimated ? " · estimate" : ""}</strong></div>
                      <div><span>SUGGESTED TIME</span><strong>{taskProposal.canSchedule ? `${taskProposal.time} – ${humanTime(taskProposal.endTime)}` : "Not available"}</strong></div>
                    </div>
                    <div className="command-course-link-field">
                      <label htmlFor="planning-course-link">LINK THIS TASK TO A COURSE</label>
                      <select id="planning-course-link" value={taskProposal.courseId ?? ""} onChange={(event) => {
                        const course = resourceCourses.find((candidate) => candidate.id === event.target.value);
                        setTaskProposal((current) => {
                          if (!current) return current;
                          const cleanNote = current.schedulingNote.replace(/\s*(?:Linked to|The task can be linked to) [^.]+\.?/g, "").trim();
                          return { ...current, courseId: course?.id ?? null, courseTitle: course?.title ?? null, schedulingNote: `${cleanNote}${course ? ` Task will be linked to ${course.title}.` : ""}` };
                        });
                      }}>
                        <option value="">General task — no course</option>
                        {resourceCourses.map((course) => <option key={course.id} value={course.id}>{course.title}{course.course_code ? ` · ${course.course_code}` : ""}</option>)}
                      </select>
                      <small>{resourceCourses.length ? (taskProposal.courseTitle ? `Matched to ${taskProposal.courseTitle}. You can change this before creating the task.` : "Pick a saved course, or leave this as a general task.") : "Add courses in Courses & sessions to link academic tasks. Saved classes are still protected during scheduling."}</small>
                    </div>
                    <p className="command-task-schedule-note">{taskProposal.schedulingNote}</p>
                    {existingTaskForProposal ? (
                      <div className="command-duplicate-warning" role="status" aria-live="polite">
                        <span className="section-overline">EXISTING TASK FOUND</span>
                        <strong>Let's update the task you already have.</strong>
                        <p>“{existingTaskForProposal.title}” is already in Tasks and is {existingTaskForProposal.done ? "marked complete" : "still open"}. CampusMate will not create a duplicate. {existingTaskForProposal.done ? "You can reopen it and apply this schedule to the existing task." : "You can update its schedule without creating a duplicate."}</p>
                        <div className="command-duplicate-actions">
                          <button type="button" className="start-button" disabled={!taskProposal.canSchedule} onClick={() => updateExistingPlanningTask(true)}>{existingTaskForProposal.done ? "Reopen & schedule existing task" : "Update existing task & schedule"} <span>↗</span></button>
                          <button type="button" className="quiet-button" onClick={() => { setTaskFilter("All"); setCommandOpen(false); navigateTo("Tasks"); }}>View existing task</button>
                        </div>
                      </div>
                    ) : (
                      <div className="command-task-proposal-actions">
                        <button type="button" className="start-button" disabled={!taskProposal.canSchedule} onClick={() => addPlanningTask(true)}>Create task & schedule block <span>↗</span></button>
                        <button type="button" className="quiet-button" onClick={() => addPlanningTask(false)}>Add to Tasks only</button>
                      </div>
                    )}
                  </>}
                </section>
                )}
                {planBrief.plan.map((item, index) => (
                  <div className="plan-step" key={`${item.title}-${index}`}>
                    <span>{item.time}</span>
                    <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                    <b>{index === 0 ? "FOCUS" : index === 1 ? "NEXT" : "FLEX"}</b>
                  </div>
                ))}
                {planBrief.nextSteps.length > 0 && (
                  <div className="plan-disclaimer">
                    <strong>Suggested next steps</strong>
                    <ol>{planBrief.nextSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
                  </div>
                )}
                {planBrief.note && <p className="plan-disclaimer">{planBrief.note}</p>}
                <div className="plan-actions">
                  <button className="quiet-button" onClick={() => { setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); setPlanSaveError(""); }}>Adjust prompt <span>↺</span></button>
                  <button
                    className="start-button"
                    onClick={() => { void acceptPlanningDraft(); }}
                    disabled={planSaving || planAccepted}
                  >{planSaving ? "Saving plan…" : planAccepted ? "Plan saved" : "Accept this draft"} <span>↗</span></button>
                </div>
                {planSaveError && <p className="brief-error" role="alert">{planSaveError}</p>}
                {planAccepted && <div className="plan-accepted" role="status">Draft saved to your study plans. Your schedule has not been changed automatically.<div className="plan-accepted-actions"><button type="button" onClick={()=>{const suggestion=planBrief?.plan?.[0];if(!suggestion)return;const title=suggestion.title.trim();if(tasks.some(task=>task.title.trim().toLocaleLowerCase()===title.toLocaleLowerCase())){announce("That recommendation is already on your task list.");return;}setTasks(old=>[...old,{id:Date.now(),title,detail:suggestion.detail||"Suggested by CampusMate",time:"Not scheduled",duration:"30 min",priority:"Medium",done:false,kind:"study"}]);announce("Next step added to your task list.");}}>Add first recommendation as task</button>{tasks.some(task=>String(task.id)===String(planBrief?.priorityTaskId))&&<button type="button" onClick={()=>{const found=tasks.find(task=>String(task.id)===String(planBrief?.priorityTaskId));if(found)setTasks(old=>old.map(task=>task.id===found.id?{...task,done:true}:task));announce("Recommended task marked complete.")}}>Mark recommended task done</button>}</div></div>}
              </div>
            ) : null}
            {planError && <p className="brief-error" role="alert">{planError}</p>}
            <div className="command-footnote">Guided mode · Nothing is created until you approve it · Confirmed tasks sync with Tasks and Schedule · Bedrock is used only when enabled</div></section></div>}
    {profileOpen && <div className="modal-scrim profile-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setProfileOpen(false)}}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><button className="modal-x" onClick={()=>setProfileOpen(false)} aria-label="Close profile editor">CLOSE</button><span className="section-overline">MAKE CAMPUSMATE YOURS</span><h2 id="profile-title">Your student profile</h2><p>Personalize your space. These details belong to your account when cloud sync is set up.</p><div className="profile-photo-editor"><div className="profile-avatar-large">{profileAvatarUrl?<img src={profileAvatarUrl} alt="Profile preview"/>:profileName.trim().charAt(0).toUpperCase()||"S"}</div><div><strong>{profileName || "Student"}</strong><span>Profile picture · optional</span><button type="button" onClick={()=>profileAvatarInputRef.current?.click()}>Upload a photo</button>{profileAvatarUrl && <button type="button" className="remove-avatar" onClick={()=>{setProfileAvatarUrl("");try{localStorage.removeItem("campusmate-profile-avatar-local")}catch{}}}>Remove picture</button>}<input ref={profileAvatarInputRef} className="background-file-input" type="file" accept="image/*" onChange={event=>{void uploadProfileAvatar(event.target.files?.[0]);event.currentTarget.value=""}}/></div></div><form onSubmit={event=>{event.preventDefault();void saveProfile()}} className="profile-form"><div className="task-form-grid task-form-two"><div><label htmlFor="profile-name">Display name</label><input id="profile-name" value={profileName} maxLength={80} onChange={event=>setProfileName(event.target.value)} required/></div><div><label htmlFor="profile-college">College / university</label><input id="profile-college" value={profileCollege} maxLength={140} onChange={event=>setProfileCollege(event.target.value)} placeholder="Your college"/></div></div><div className="task-form-grid task-form-two"><div><label htmlFor="profile-course">Degree / course</label><input id="profile-course" value={profileCourse} maxLength={100} onChange={event=>setProfileCourse(event.target.value)} placeholder="B.Tech"/></div><div><label htmlFor="profile-branch">Branch / major</label><input id="profile-branch" value={profileBranch} maxLength={100} onChange={event=>setProfileBranch(event.target.value)} placeholder="Computer Science"/></div></div><div className="task-form-grid profile-three"><div><label htmlFor="profile-year">Year of study</label><select id="profile-year" value={profileYear} onChange={event=>setProfileYear(event.target.value)}><option value="">Not set</option>{[1,2,3,4,5,6].map(year=><option key={year} value={String(year)}>{year}{year===1?"st":year===2?"nd":year===3?"rd":"th"} year</option>)}</select></div><div><label htmlFor="profile-semester">Semester</label><select id="profile-semester" value={profileSemester} onChange={event=>setProfileSemester(event.target.value)}><option value="">Not set</option>{Array.from({length:12},(_,i)=><option key={i+1} value={String(i+1)}>{i+1}</option>)}</select></div><div><label htmlFor="profile-goal">Daily study goal</label><select id="profile-goal" value={profileGoalHours} onChange={event=>setProfileGoalHours(event.target.value)}>{[1,1.5,2,3,4,5,6,8,10].map(value=><option key={value} value={String(value)}>{value} {value===1?"hour":"hours"}</option>)}</select></div></div><label htmlFor="profile-bio">A little about you <small>OPTIONAL</small></label><textarea id="profile-bio" rows={2} maxLength={280} value={profileBio} onChange={event=>setProfileBio(event.target.value)} placeholder="What are you learning or working towards?"/><div className="task-form-grid task-form-two"><div><label htmlFor="profile-start">Preferred study time starts</label><input id="profile-start" type="time" value={profilePreferredStart} onChange={event=>setProfilePreferredStart(event.target.value)}/></div><div><label htmlFor="profile-end">Preferred study time ends</label><input id="profile-end" type="time" value={profilePreferredEnd} onChange={event=>setProfilePreferredEnd(event.target.value)}/></div></div><div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setProfileOpen(false)}>Cancel</button><button type="submit" className="start-button" disabled={profileSaving}>{profileSaving?"Saving…":"Save profile"} <span>↗</span></button></div></form><div className="profile-account-link"><a href="/auth">Account & sign-in settings ↗</a></div><div className="profile-private-note">Your profile is saved to your signed-in account when available, or to this browser in local mode. Apply the included Supabase migration to enable cloud profile sync and image uploads.</div></section></div>}
    {settingsOpen && <div className="modal-scrim settings-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-x" onClick={() => setSettingsOpen(false)} aria-label="Close settings">CLOSE</button><span className="section-overline">YOUR PREFERENCES</span><h2 id="settings-title">How much help feels right?</h2><p>Choose how CampusMate handles the flexible parts of your day. You can change this whenever you like.</p><section className="appearance-settings"><div className="background-settings-heading"><span className="section-overline">APPEARANCE</span><strong>Choose your atmosphere</strong><p>A softer sky-purple night tone, without going full black. Your choice is saved on this device.</p></div><div className="tone-options"><button type="button" className={`tone-option light-tone-option ${!darkTone ? "chosen" : ""}`} onClick={() => changeTone(false)}><span className="tone-preview light-tone-preview"/><span><strong>Daylight</strong><small>Warm, airy and clear</small></span><span className="tone-radio">{!darkTone ? "SELECTED" : ""}</span></button><button type="button" className={`tone-option purple-tone-option ${darkTone ? "chosen" : ""}`} onClick={() => changeTone(true)}><span className="tone-preview purple-tone-preview"/><span><strong>Sky purple</strong><small>Dusky violet, blue and lavender</small></span><span className="tone-radio">{darkTone ? "SELECTED" : ""}</span></button></div></section><section className="background-settings"><div className="background-settings-heading"><span className="section-overline">MAKE IT YOURS</span><strong>Your background</strong><p>Upload a photo you love. It will sit behind the dashboard with a soft overlay so everything stays readable.</p></div><div className="background-preview" style={{ backgroundImage: `linear-gradient(90deg,rgba(247,245,239,.24),rgba(247,245,239,.08)),url("${backgroundImage}")` }}><span>{customBackground ? "YOUR PHOTO" : "FOLLOWS LOCAL TIME"}</span><small>{customBackground ? backgroundName || "Custom image" : `${timeLabel(localHour).toLowerCase()} · ${activeScene.name}`}</small></div><input ref={backgroundInputRef} className="background-file-input" type="file" accept="image/*" onChange={event => { void uploadBackground(event.target.files?.[0]); event.currentTarget.value = ""; }} /><div className="background-actions"><button type="button" className="background-upload-button" onClick={() => backgroundInputRef.current?.click()}>{customBackground ? "Choose another photo" : "Upload a photo"}</button>{customBackground && <button type="button" className="background-reset-button" onClick={resetBackground}>Use time-based backgrounds</button>}</div><small className="background-storage-note">Your image is saved in this browser on this device. It isn't uploaded to a server.</small></section><div className="settings-options"><button className={`settings-option ${automation === "guided" ? "selected" : ""}`} onClick={() => { setAutomation("guided"); announce("Guided mode selected"); }}><span className="settings-option-title">Guided</span><span className="settings-option-desc">Get suggestions, understand the trade-offs, and decide what changes.</span><span className="settings-option-foot">YOU STAY IN CONTROL</span></button><button className={`settings-option ${automation === "autopilot" ? "selected" : ""}`} onClick={() => { setAutomation("autopilot"); announce("Auto-pilot selected"); }}><span className="settings-option-title">Auto-pilot</span><span className="settings-option-desc">Let CampusMate rearrange flexible study blocks when your day changes. Fixed commitments stay protected.</span><span className="settings-option-foot">ROUTINE CHANGES, HANDLED</span></button></div><div className="settings-note">Important decisions—like cancelling commitments—always stay yours.</div><div className="settings-modal-actions"><button className="start-button" onClick={() => setSettingsOpen(false)}>Done <span>↗</span></button></div></section></div>}
    {addOpen && <div className="modal-scrim task-modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setAddOpen(false); }}><section className="add-modal task-editor-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><button className="modal-x" onClick={() => { setAddOpen(false); setEditingTaskId(null); }} aria-label="Close">CLOSE</button><span className="section-overline">MAKE A LITTLE SPACE</span><h2 id="add-title">{editingTaskId !== null ? "Tune this task." : "What’s on your mind?"}</h2><p>{editingTaskId !== null ? "Keep the details realistic. You can always adjust them later." : "Add one thing, choose when to work on it, and set a deadline only if you need one."}</p><form onSubmit={event => { event.preventDefault(); editingTaskId !== null ? saveTaskEdit() : addTask(); }}>
      <label htmlFor="task-draft">Task or reminder</label><input autoFocus id="task-draft" value={taskDraft} onChange={event=>setTaskDraft(event.target.value)} maxLength={180} placeholder="e.g. Finish calculus problem set" required/>
      <label htmlFor="task-detail-draft">A little context <small>OPTIONAL</small></label><input id="task-detail-draft" value={taskDetailDraft} onChange={event=>setTaskDetailDraft(event.target.value)} maxLength={300} placeholder="Subject, room, what to remember…"/>
      <div className="task-form-grid task-form-three"><div><label htmlFor="task-priority-draft">Priority</label><select id="task-priority-draft" value={taskPriorityDraft} onChange={event=>setTaskPriorityDraft(event.target.value as Task["priority"])}><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select></div><div><label htmlFor="task-scheduled-date">Planned date</label><input id="task-scheduled-date" type="date" value={taskScheduledDateDraft} onChange={event=>setTaskScheduledDateDraft(event.target.value)}/></div><div><label htmlFor="task-start-time">Start time</label><input id="task-start-time" type="time" value={taskStartTimeDraft} onChange={event=>{setTaskStartTimeDraft(event.target.value);setTaskTimeDraft(event.target.value?humanTime(event.target.value):"Not scheduled")}}/></div></div>
      <div className="task-form-grid task-form-two"><div><label htmlFor="task-end-time">End time <small>OPTIONAL</small></label><input id="task-end-time" type="time" value={taskEndTimeDraft} min={taskStartTimeDraft||undefined} onChange={event=>setTaskEndTimeDraft(event.target.value)}/></div><div className="task-duration-hint"><span>PLANNED BLOCK</span><strong>{taskStartTimeDraft ? `${humanTime(taskStartTimeDraft)}${taskEndTimeDraft ? ` – ${humanTime(taskEndTimeDraft)}` : ""}` : "Choose a start time"}</strong><small>{taskStartTimeDraft && taskEndTimeDraft ? taskDuration(taskStartTimeDraft,taskEndTimeDraft) : "You can leave this flexible"}</small></div></div>
      <div className="task-deadline-box"><div className="task-deadline-heading"><div><span className="section-overline">OPTIONAL</span><strong>Deadline & reminder</strong></div><span>WHEN MUST IT BE DONE?</span></div><div className="task-form-grid task-form-two"><div><label htmlFor="task-deadline-date">Deadline date</label><input id="task-deadline-date" type="date" min={taskScheduledDateDraft||undefined} value={taskDeadlineDateDraft} onChange={event=>setTaskDeadlineDateDraft(event.target.value)}/></div><div><label htmlFor="task-deadline-time">Deadline time</label><input id="task-deadline-time" type="time" value={taskDeadlineTimeDraft} onChange={event=>setTaskDeadlineTimeDraft(event.target.value)}/></div></div><div className="task-form-grid task-form-two"><div><label htmlFor="task-reminder">Remind me</label><select id="task-reminder" value={taskReminderDraft} onChange={event=>setTaskReminderDraft(Number(event.target.value))} disabled={!taskDeadlineDateDraft || !taskDeadlineTimeDraft}><option value={-1}>No reminder</option><option value={1440}>1 day before</option><option value={60}>1 hour before</option><option value={30}>30 minutes before</option><option value={15}>15 minutes before</option><option value={0}>At the deadline</option></select></div><p className="task-reminder-note">CampusMate can show a desktop notification while the app is open. Browser permission is needed; background alerts require push notification setup.</p></div></div>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>{setAddOpen(false);setEditingTaskId(null)}}>Cancel</button><button type="submit" className="start-button" disabled={!taskDraft.trim()}>{editingTaskId!==null?"Save changes":"Add to my list"} <span>↗</span></button></div></form></section></div>}
    {toast && <div className="toast"><span className="toast-check">NOTE</span>{toast}<button onClick={() => setToast("")} aria-label="Dismiss">DISMISS</button></div>}
  </main>;
}
