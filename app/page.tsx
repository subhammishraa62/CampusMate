"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildRuleBasedBrief } from "@/lib/planning/engine";
import type { DailyBrief } from "@/lib/planning/types";

type Scene = "terrace" | "orbit" | "greenhouse" | "bluehour";
type Task = { id: number; title: string; detail: string; time: string; duration: string; priority: "Today" | "Soon" | "Whenever"; done: boolean; kind: "study" | "class" | "life" };
type ResourceCourse = { id: string; title: string };
type ResourceClassSession = { id: string; course_id: string | null; title: string; location: string | null; starts_at: string; ends_at: string; notes?: string | null };
type ScheduleEntry = { key: string; title: string; detail: string; time: string; duration: string; done: boolean; kind: "study" | "class" | "life" };
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
function compactMinutes(value: number): string {
  const safe = Math.max(0, value);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("Today");
  const [routeTransition, setRouteTransition] = useState<{ phase: "cover" | "reveal"; target: string; id: number } | null>(null);
  const routeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const routeTransitionIdRef = useRef(0);
  const [profileName, setProfileName] = useState("Student");
  const [profileCourse, setProfileCourse] = useState("");
  const [profileYear, setProfileYear] = useState("");
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
  const [taskPriorityDraft, setTaskPriorityDraft] = useState<Task["priority"]>("Soon");
  const [taskTimeDraft, setTaskTimeDraft] = useState("Not scheduled");
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [taskFilter, setTaskFilter] = useState<"All" | "Open" | "Done">("All");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
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
  const [focusOn, setFocusOn] = useState(false);
  const doneCount = tasks.filter(task => task.done).length;
  const remaining = tasks.length - doneCount;
  const activeScene = scenes.find(item => item.id === scene)!;
  const backgroundImage = customBackground || activeScene.image;
  const nextTask = tasks.find(task => !task.done);
  const greeting = localHour < 12 ? "Good morning." : localHour < 17 ? "Good afternoon." : localHour < 21 ? "Good evening." : "A quieter night, perhaps.";
  const today = new Date();
  const weekday = today.toLocaleDateString("en-IN", { weekday: "long" });
  const dateShort = today.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
  const dueTodayCount = tasks.filter(task => !task.done && task.priority === "Today").length;
  const localDateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
        duration: minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`,
        priority: "Today", done: false, kind: "class" as const,
      };
    });
  const plannerTasks = [...tasks, ...plannerClassTasks];
  const scheduleEntries: ScheduleEntry[] = [
    ...tasks.map((task) => ({ key: `task-${task.id}`, title: task.title, detail: task.detail, time: task.time, duration: task.duration, done: task.done, kind: task.kind })),
    ...plannerClassTasks.map((task) => ({ key: `class-${task.id}`, title: task.title, detail: task.detail, time: task.time, duration: task.duration, done: false, kind: task.kind })),
  ].sort((a, b) => {
    const minuteOfDay = (value: string) => {
      const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return Number.MAX_SAFE_INTEGER;
      return (Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2]);
    };
    return minuteOfDay(a.time) - minuteOfDay(b.time);
  });
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
          setTasks(withoutDemoTasks(payload.tasks));
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

  function announce(text: string) { setToast(text); window.setTimeout(() => setToast(""), 2600); }
  function addTask() {
    if (!taskDraft.trim()) return;
    setTasks(old => [...old, { id: Date.now(), title: taskDraft.trim(), detail: taskDetailDraft.trim() || "Added just now", time: taskTimeDraft, duration: "30 min", priority: taskPriorityDraft, done: false, kind: "study" }]);
    setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Soon"); setAddOpen(false); announce("Added to your list");
  }
  function beginEditTask(task: Task) {
    setEditingTaskId(task.id); setTaskDraft(task.title); setTaskDetailDraft(task.detail); setTaskTimeDraft(task.time); setTaskPriorityDraft(task.priority); setAddOpen(true);
  }
  function removeTask(id: number) {
    setTasks(old => old.filter(task => task.id !== id));
    announce("Task removed");
  }
  function saveTaskEdit() {
    if (!taskDraft.trim() || editingTaskId === null) return;
    setTasks(old => old.map(task => task.id === editingTaskId ? { ...task, title: taskDraft.trim(), detail: taskDetailDraft.trim() || "No extra details", time: taskTimeDraft, priority: taskPriorityDraft } : task));
    setEditingTaskId(null); setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Soon"); setAddOpen(false); announce("Task updated");
  }
  function sendMessage(text = message) {
    if (!text.trim()) return;
    setReply("I’d protect your fixed classes first, then use the next open window for the closest deadline. This preview uses sample schedule data, so treat it as a starting point—not a live plan.");
    setMessage("");
  }

  async function generateIntelligenceBrief() {
    setBriefLoading(true);
    setBriefError("");
    try {
      const response = await fetch("/api/intelligence-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: plannerTasks, context: briefContext }),
      });
      const payload = await response.json() as { brief?: DailyBrief; error?: string };
      if (!response.ok || !payload.brief) throw new Error(payload.error || "CampusMate couldn't prepare the brief. Try again.");
      setBriefData(payload.brief);
      announce(payload.brief.engine === "ai" ? "Amazon Bedrock daily brief is ready" : "Daily brief refreshed using the planning engine");
    } catch (cause) {
      setBriefError(cause instanceof Error ? cause.message : "The brief could not be refreshed. Your local preview is still available.");
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

    try {
      const response = await fetch("/api/intelligence-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: plannerTasks, context }),
      });
      const payload = await response.json() as { brief?: DailyBrief; error?: string };
      if (!response.ok || !payload.brief) {
        throw new Error(payload.error || "CampusMate couldn't generate your plan. Please try again.");
      }
      setPlanBrief(payload.brief);
      setBriefData(payload.brief);
      setBriefContext(context);
      setPlanGenerated(true);
      announce(payload.brief.engine === "ai"
        ? "Bedrock-assisted Planning Studio draft generated"
        : "Planning Studio draft generated using CampusMate's rules-based engine");
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : "Couldn't generate your plan. Please try again.");
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
      <a className="nav-link secondary-nav" href="/integrations"><span className="nav-number">08</span><span>Integration health</span></a>
      <button className="nav-link secondary-nav" onClick={() => { setCommandOpen(true); setMobileNav(false); }}><span className="nav-number">06</span><span>AI command center</span></button>
      <div className="sidebar-bottom"><div className="handwritten-note"><span className="note-mark">A NOTE TO SELF</span><p>One thing at a time.<br/>You’re doing alright.</p><span className="note-line"/></div>
        <button className="nav-link settings-link" onClick={() => { setSettingsOpen(true); setMobileNav(false); }}><span className="nav-number">07</span><span>Preferences</span></button>
        <div className="profile"><div className="profile-pic">{profileName.charAt(0).toUpperCase()}</div><div className="profile-info"><strong>{profileName}</strong>{[profileYear, profileCourse].filter(Boolean).length > 0 && <span>{[profileYear, profileCourse].filter(Boolean).join(" · ")}</span>}</div><button aria-label="Open account and cloud sync" title="Account and cloud sync" onClick={() => { window.location.assign("/auth"); }}>•••</button></div>
      </div>
    </aside>

    <section className="main-area" id="top">
      <header className="topbar"><button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav(value => !value)}>MENU</button><div className="crumb"><span>My space</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
        <div className="top-actions"><div className="date-chip"><span>{weekday.toUpperCase()}</span><b>{dateShort}</b></div><button className="top-text-button" onClick={() => announce("Search is coming soon")}>SEARCH</button><button className="top-text-button" onClick={() => announce("You’re all caught up")}>INBOX <span className="inbox-dot"/></button><div className="tiny-avatar">{profileName.charAt(0).toUpperCase()}</div>

        </div>
      </header>
      <div className="page-content" key={activeNav}>
        {activeNav === "Today" ? <>
        <section className="intro-row"><div className="intro-copy"><div className="eyebrow"><span className="eyebrow-dot"/> {timeLabel(localHour)} · YOUR DAILY RESET</div><h1>{greeting}<br/><em>Let’s make room.</em></h1><p>A clearer view of your day, with a little less noise around it.</p></div><div className="intro-actions"><button className="plan-day-button" onClick={() => { setCommandOpen(true); setPlanGenerated(false); setPlanAccepted(false); }}><span>↗</span> Plan my day</button><button className="add-button" onClick={() => { setEditingTaskId(null); setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Soon"); setAddOpen(true); }}><span>+</span> Add something</button></div></section>
        <section className="daily-glance" aria-label="Your day at a glance">
          <div className="glance-intro"><span className="section-overline">AT A GLANCE</span><strong>Today, without the noise.</strong></div>
          <div className="glance-stat"><span>OPEN TASKS</span><strong>{remaining.toString().padStart(2, "0")}</strong><small>{remaining === 1 ? "one thing at a time" : "room to make progress"}</small></div>
          <div className="glance-stat"><span>PRIORITIES TODAY</span><strong>{dueTodayCount.toString().padStart(2, "0")}</strong><small>the things to protect</small></div>
          <div className="glance-stat"><span>YOU’VE FINISHED</span><strong>{Math.round(doneCount / Math.max(tasks.length, 1) * 100)}<i>%</i></strong><small>{doneCount ? "progress is progress" : "start small, start anywhere"}</small></div>
        </section>
        <section className="intelligence-brief" aria-labelledby="intelligence-title">
          <div className="intelligence-header">
            <div>
              <span className="section-overline">CAMPUSMATE / DAILY INTELLIGENCE</span>
              <h2 id="intelligence-title">{visibleBrief.headline}</h2>
              <p>{visibleBrief.summary}</p>
            </div>
            <span className={`brief-engine ${visibleBrief.engine === "ai" ? "is-ai" : "is-rules"}`}><i />{visibleBrief.engine === "ai" ? "BEDROCK-ASSISTED" : "PLANNING ENGINE"}</span>
          </div>
          <div className="intelligence-grid">
            <div className="brief-priority">
              <span className="brief-label">YOUR NEXT BEST MOVE</span>
              <h3>{visibleBrief.priorityTitle}</h3>
              <p>{visibleBrief.reason}</p>
              <button className="brief-open-tasks" onClick={() => { navigateTo("Tasks"); announce("Open tasks to adjust your next move"); }}>Review my task list <span>↗</span></button>
            </div>
            <div className="brief-steps">
              <span className="brief-label">THREE GOOD NEXT STEPS</span>
              <ol>{visibleBrief.nextSteps.map((step, index) => <li key={`${index}-${step}`}><span>0{index + 1}</span><p>{step}</p></li>)}</ol>
            </div>
          </div>
          <div className="brief-plan">
            <div className="brief-plan-heading"><span className="brief-label">A FLEXIBLE FIRST DRAFT</span><span>NOTHING CHANGES UNTIL YOU DO</span></div>
            <div className="brief-plan-items">{visibleBrief.plan.map((item, index) => <article className="brief-plan-item" key={`${item.title}-${index}`}><span className="brief-plan-time">{item.time}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>
          </div>
          <div className="brief-controls">
            <label className="brief-context"><span>ANYTHING CAMPUSMATE SHOULD CONSIDER?</span><input value={briefContext} onChange={event => { setBriefContext(event.target.value); setBriefData(null); setMcpDemoResult(null); }} maxLength={300} placeholder="Low energy, an exam coming up, or a plan change…" /></label>
            <div className="brief-control-actions">
              <button className="brief-generate" onClick={generateIntelligenceBrief} disabled={briefLoading}>{briefLoading ? <><i className="brief-spinner"/> THINKING…</> : <>Refresh intelligence <span>↗</span></>}</button>
              <button className="mcp-demo-button" onClick={runMcpAgentDemo} disabled={mcpDemoLoading}>{mcpDemoLoading ? <><i className="brief-spinner"/> CHECKING MCP…</> : <>Run Alexa+ MCP test <span>↗</span></>}</button>
            </div>
          </div>
          {mcpDemoResult && <div className="mcp-demo-result" role="status"><div className="mcp-demo-indicator"><i/> STREAMABLE HTTP · CONNECTED</div><p><strong>{mcpDemoResult.calls?.length ?? 0} real tool calls completed.</strong> {mcpDemoResult.calls?.join(" → ")}. {mcpDemoResult.openTaskCount ?? "—"} open tasks inspected via the MCP client. Provider: {mcpDemoResult.provider ?? "CampusMate planner"}.</p><small>Protocol: {mcpDemoResult.protocol ?? "negotiated"} · Server: {mcpDemoResult.server?.name ?? "campusmate-ai"} {mcpDemoResult.server?.version ?? ""}</small></div>}
          {mcpDemoError && <p className="brief-error" role="alert">MCP test failed: {mcpDemoError}</p>}
          <div className="brief-footnote"><span>{briefData?.note ?? "Rules-based planning works without cloud credentials. Enable Amazon Bedrock for AI-assisted explanations; use the Alexa+ MCP test to verify real Streamable HTTP tool calls."}</span><span>{briefData?.generatedAt ? `UPDATED ${new Date(briefData.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "LIVE PREVIEW FROM YOUR CURRENT TASKS"}</span></div>
          {briefError && <p className="brief-error" role="alert">{briefError}</p>}
        </section>
        <div className="dashboard-layout"><div className="left-stack">
          <section className="next-card"><div className="next-card-top"><span className="micro-label"><span className="live-dot"/> A GOOD PLACE TO START</span><span className="card-index">01 <span>/ 03</span></span></div>
            <div className="next-card-body"><div className="next-copy"><div className="task-kicker">{nextTask ? nextTask.kind === "class" ? "ON YOUR TIMETABLE" : nextTask.kind === "life" ? "MAKE ROOM FOR YOU" : "A SMALL ACADEMIC WIN" : "A MOMENT TO YOURSELF"}</div><h2>{nextTask ? nextTask.title : "You’ve cleared the list."}</h2><p>{nextTask ? `Start with “${nextTask.title}”. ${nextTask.detail}. A little progress now can make the rest of the day feel lighter.` : "Your open loops are closed for now. Take a proper break, or add something new when you’re ready."}</p><div className="next-meta"><span>{nextTask ? nextTask.time : "No task waiting"}</span><span className="meta-divider"/><span>{nextTask ? nextTask.duration : "Take a breath"}</span></div><div className="next-actions"><button className="start-button" onClick={() => { setFocusOn(value => !value); announce(focusOn ? "Focus session paused" : "Focus session started"); }}>{focusOn ? "FOCUS SESSION ACTIVE" : "START A FOCUS SESSION"}<span>↗</span></button><button className="quiet-button" onClick={() => sendMessage("Can you suggest another task for me?")}>Not feeling this <span>↘</span></button></div></div>
              <div className="progress-art"><div className="paper-note note-a"><span>FIELD NOTE / 01</span><strong>Small steps<br/>still count.</strong><i>— a reminder</i></div><div className="progress-stamp"><svg viewBox="0 0 120 120" role="img" aria-label="70 percent complete"><circle cx="60" cy="60" r="48"/><circle className="progress-value" cx="60" cy="60" r="48" style={{ strokeDashoffset: 301.6 - (doneCount / Math.max(tasks.length, 1)) * 301.6 }}/></svg><div><strong>{Math.round(doneCount / Math.max(tasks.length, 1) * 100)}<small>%</small></strong><span>COMPLETE</span></div></div><div className="orbit-caption">CURRENT MOMENT <span>·</span> 35 MIN</div></div>
            </div><div className="next-card-foot"><div className="why-mark">WHY THIS, NOW?</div><div><strong>{nextTask ? nextTask.priority === "Today" ? "This deserves a place today." : "A gentle place to begin." : "Nothing urgent is asking for you."}</strong><span>{nextTask ? "Keep the next step small, then reassess. You don’t have to solve the whole day at once." : "Enjoy the breathing room, or make a fresh plan when you need one."}</span></div><button onClick={() => { setPlanPrompt(nextTask ? `Help me fit “${nextTask.title}” into my day. ${nextTask.detail}.` : "Help me plan a balanced day with study, breaks and personal time."); setPlanGenerated(false); setPlanAccepted(false); setCommandOpen(true); }}>Talk it through <span>↗</span></button></div>
          </section>
          <section className="schedule-section"><div className="section-title-row"><div><span className="section-overline">THE SHAPE OF TODAY</span><h3>Your day, in pieces <span className="date-small">{weekday.slice(0, 3).toUpperCase()} · {today.getDate().toString().padStart(2, "0")}</span></h3></div><button className="text-link" onClick={() => navigateTo("Schedule")}>See full schedule <span>↗</span></button></div>
            <div className="schedule-card">{scheduleEntries.length ? scheduleEntries.slice(0, 7).map((entry, index, visible) => {
              const match = entry.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
              const timeMain = match ? `${Number(match[1])}:${match[2]}` : "FLEX";
              const period = match?.[3]?.toUpperCase() ?? "";
              const duration = entry.duration.replace(/\bmin(?:ute)?s?\b/i, "MIN").replace(/\bhr(?:s)?\b/i, "HOUR").replace(/\bhours?\b/i, "HOUR").toUpperCase();
              return <div className={`schedule-row ${entry.done ? "completed" : index === 0 ? "up-next" : ""} ${index === visible.length - 1 ? "last-event" : ""}`} key={entry.key}>
                <div className="schedule-time">{timeMain}{period && <small>{period}</small>}</div>
                <div className="schedule-track"><span className="track-node">{String(index + 1).padStart(2, "0")}</span>{index < visible.length - 1 && <span className="track-stem"/>}</div>
                <div className="schedule-detail"><strong>{entry.title}{index === 0 && !entry.done && <b>UP NEXT</b>}</strong><span>{entry.detail || (entry.kind === "class" ? "Fixed class commitment" : "A small step in your day")}</span></div>
                <span className="event-length">{duration || "FLEX"}</span>
              </div>;
            }) : <div className="schedule-row last-event"><div className="schedule-time">OPEN</div><div className="schedule-track"><span className="track-node">01</span></div><div className="schedule-detail"><strong>No schedule items yet.</strong><span>Add a task or class to give the day a little shape.</span></div><span className="event-length">FLEX</span></div>}</div>
          </section>
          <section className="tasks-section"><div className="section-title-row"><div><span className="section-overline">THE OPEN LOOPS</span><h3>Things on your mind <span className="count-pill">{remaining} LEFT</span></h3></div><button className="text-link" onClick={() => navigateTo("Tasks")}>All tasks <span>↗</span></button></div>
            <div className="tasks-card">{tasks.map((task, index) => <div className={`task-row ${task.done ? "task-is-done" : ""}`} key={task.id}><button className={`task-check ${task.done ? "checked" : ""}`} aria-label={task.done ? "Mark as not done" : "Mark as done"} onClick={() => setTasks(old => old.map(item => item.id === task.id ? { ...item, done: !item.done } : item))}>{task.done ? "✓" : ""}</button><span className="task-number">0{index + 1}</span><div className="task-main"><strong>{task.title}</strong><span>{task.detail}</span></div><span className={`priority-tag ${task.priority.toLowerCase()}`}>{task.priority}</span><div className="task-time"><strong>{task.time}</strong><span>{task.duration}</span></div><button className="row-more" aria-label={`Options for ${task.title}`} onClick={() => announce(`Options for ${task.title}`)}>•••</button></div>)}</div>
          </section>
        </div>
        <aside className="right-stack">
          <section className="week-card"><div className="side-card-heading"><div><span className="section-overline">A QUICK CHECK-IN</span><h3>Your week, as it is.</h3></div><span className="week-index">YOUR PACE</span></div><p className="week-copy">{remaining ? `${remaining} open item${remaining === 1 ? "" : "s"} to work through. Keep fixed classes protected and let flexible work move when life does.` : "Your open task list is clear. Leave a little room for rest and the unexpected."}</p><div className="week-meter"><div className="meter-top"><span>Task completion</span><strong>{completionRate}% <small>of list</small></strong></div><div className="meter-track"><span style={{ width: `${completionRate}%` }}/></div><div className="meter-legend"><span><i className="dot-study"/> Completed</span><span><i className="dot-rest"/> Still open</span></div></div><div className="week-bottom"><div><strong>{compactMinutes(estimatedOpenMinutes)}</strong><span>open task estimate</span></div><div><strong>{dueTodayCount}</strong><span>priorities today</span></div><div><strong>{classSessionsToday.length}</strong><span>classes today</span></div></div></section>
          <section className="note-card"><div className="note-card-top"><div><span className="section-overline">A NOTE FROM CAMPUSMATE</span><strong>One thing worth knowing</strong><span className="note-status">HERE IF YOU NEED A HAND</span></div><span className="note-index">NOTE 01</span></div><p>{nextTask ? `“${nextTask.title}” is still on your list${nextTask.priority === "Today" ? " and marked for today" : ""}. Keep the first step small, then reassess rather than trying to solve the whole day at once.` : "Your open task list is clear. You can leave the time open, or take two minutes to look at tomorrow."}</p><button className="note-action" onClick={() => sendMessage(nextTask ? `Help me fit “${nextTask.title}” into today` : "Help me make a balanced plan for tomorrow")}>{nextTask ? "Fit it into my day" : "Look at tomorrow"} <span>↗</span></button></section>
          <section className="chat-card"><div className="chat-heading"><div className="companion-heading"><span className="companion-orb" aria-hidden="true"><span/><span/><span/></span><div><span className="section-overline">A LITTLE HELP, WHEN YOU NEED IT</span><strong>Talk it through</strong><span>No perfect plan required.</span></div></div><span className="chat-presence">HERE</span></div><div className="prompt-list"><button onClick={() => sendMessage("What should I focus on next?")}>What should I do next? <span>↗</span></button><button onClick={() => sendMessage("Help me rebalance my day")}>I’m running behind <span>↗</span></button><button onClick={() => sendMessage("Do I have enough time today?")}>Is my day too full? <span>↗</span></button></div>{reply && <div className="chat-reply"><span>YOUR PLANNER SAYS</span><p>{reply}</p></div>}<form className="chat-form" onSubmit={event => { event.preventDefault(); sendMessage(); }}><input id="ask-campusmate" value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell me what’s changed…" aria-label="Message CampusMate"/><button disabled={!message.trim()} aria-label="Send message">SEND <span>↗</span></button></form><span className="chat-footnote">A suggestion, not a command.</span></section>
          <section className="small-progress"><div className="progress-head"><span>TODAY SO FAR</span><strong>{doneCount} OF {tasks.length}</strong></div><div className="progress-bar"><span style={{ width: `${doneCount / Math.max(tasks.length, 1) * 100}%` }}/></div><p>{doneCount === 0 ? "No need to sprint. Start wherever you are." : doneCount === tasks.length ? "Everything on this list is done. Take a breath." : "A few things off your mind already."}</p></section>
        </aside></div>
        </> : <section className="planner-page">
          <div className="planner-hero"><div><span className="section-overline">CAMPUSMATE / YOUR PLANNER</span><h1>{activeNav === "Tasks" ? <>Make space<br/><em>for what matters.</em></> : activeNav === "Schedule" ? <>A day with<br/><em>a little structure.</em></> : activeNav === "My week" ? <>The week ahead,<br/><em>at your pace.</em></> : <>Your campus,<br/><em>in one place.</em></>}</h1><p>{activeNav === "Tasks" ? "A flexible list for the things you want to move forward." : activeNav === "Schedule" ? "Your commitments and focus blocks, gathered in one clear timeline." : activeNav === "My week" ? "A gentle overview of what is done, what is next, and where you have room." : "Keep the places and classes that shape your week close at hand."}</p></div><button className="plan-day-button" onClick={() => { setEditingTaskId(null); setTaskDraft(""); setTaskDetailDraft(""); setTaskTimeDraft("Not scheduled"); setTaskPriorityDraft("Soon"); setAddOpen(true); }}>＋ Add a task</button></div>
          {activeNav === "Tasks" && <>
            <div className="planner-summary"><div><span>OPEN</span><strong>{remaining.toString().padStart(2,"0")}</strong><small>still in progress</small></div><div><span>PRIORITIES</span><strong>{dueTodayCount.toString().padStart(2,"0")}</strong><small>marked for today</small></div><div><span>COMPLETED</span><strong>{doneCount.toString().padStart(2,"0")}</strong><small>small wins count</small></div></div>
            <div className="planner-toolbar"><div className="planner-tabs">{(["All","Open","Done"] as const).map(filter => <button key={filter} className={taskFilter === filter ? "selected" : ""} onClick={() => setTaskFilter(filter)}>{filter}<span>{filter === "All" ? tasks.length : filter === "Open" ? remaining : doneCount}</span></button>)}</div><span className="planner-hint">{cloudSyncEnabled ? (cloudSyncStatus === "syncing" ? "SYNCING TO CLOUD…" : cloudSyncStatus === "synced" ? "CLOUD SYNC ON" : "SYNC NEEDS ATTENTION") : "SAVED ON THIS DEVICE"}</span></div>
            <div className="planner-task-list">{tasks.filter(task => taskFilter === "All" || (taskFilter === "Open" ? !task.done : task.done)).map((task,index) => <article className={`planner-task ${task.done ? "is-done" : ""}`} key={task.id}><button className={`task-check ${task.done ? "checked" : ""}`} aria-label={task.done ? "Mark as open" : "Complete task"} onClick={() => setTasks(old => old.map(item => item.id === task.id ? {...item,done:!item.done}:item))}>{task.done ? "✓" : ""}</button><span className="planner-task-index">{String(index+1).padStart(2,"0")}</span><div className="planner-task-copy"><strong>{task.title}</strong><span>{task.detail}</span><div className="planner-task-meta"><span>{task.time}</span><span>{task.duration}</span><span className={`priority-tag ${task.priority.toLowerCase()}`}>{task.priority}</span></div></div><div className="planner-task-actions"><button onClick={() => beginEditTask(task)}>EDIT</button><button onClick={() => removeTask(task.id)}>REMOVE</button></div></article>)}{tasks.filter(task => taskFilter === "All" || (taskFilter === "Open" ? !task.done : task.done)).length === 0 && <div className="planner-empty"><span className="section-overline">A CLEAR PATCH OF SKY</span><h3>Nothing here for now.</h3><p>Enjoy the breathing room, or add something when it comes to mind.</p><button className="start-button" onClick={() => {setEditingTaskId(null);setTaskDraft("");setAddOpen(true)}}>Add a task <span>↗</span></button></div>}</div>
          </>}
          {activeNav === "Schedule" && <div className="planner-timeline-card"><div className="timeline-heading"><div><span className="section-overline">TODAY · {weekday.toUpperCase()}</span><h3>Everything has a place.</h3></div><span>{scheduleEntries.length} ITEMS</span></div>{scheduleEntries.map((entry,index)=>{const task=tasks.find(item=>`task-${item.id}`===entry.key);return <div className={`planner-event ${entry.done?"is-done":""}`} key={entry.key}><div className="planner-event-time">{entry.time === "Not scheduled" ? "FLEX" : entry.time}</div><div className="planner-event-rail"><span>{String(index+1).padStart(2,"0")}</span><i/></div><div className="planner-event-body"><strong>{entry.title}</strong><span>{entry.detail || (entry.kind === "class" ? "Fixed class commitment" : "A small step in your day")}</span><small>{entry.duration} · {entry.kind === "class" ? "FIXED COMMITMENT" : task?.priority.toUpperCase() ?? "SCHEDULED"}</small></div>{task && <><button className={`task-check ${task.done ? "checked" : ""}`} onClick={() => setTasks(old => old.map(item => item.id===task.id?{...item,done:!item.done}:item))} aria-label="Toggle completion">{task.done?"✓":""}</button><button className="event-edit" onClick={() => beginEditTask(task)}>EDIT</button></>}</div>})}{scheduleEntries.length===0 && <div className="planner-empty"><h3>A clear stretch of time.</h3><p>Add a task or a class to give today a little shape.</p></div>}<div className="timeline-bottom-note">{cloudSyncEnabled ? "Planner tasks sync to your account; saved class sessions are read from your learning space." : "Planner tasks stay on this device. Saved classes from your learning space appear here when available."}</div></div>}
          {activeNav === "Schedule" && <section className="schedule-campus-notes"><div className="section-title-row"><div><span className="section-overline">BEYOND THE TIMELINE</span><h3>Classes & campus notes</h3></div><a className="text-link" href="/resources">Manage classes ↗</a></div><div className="week-overview-grid"><article className="week-overview-card"><span className="section-overline">NEXT SAVED CLASS</span><h3>{classSessionsToday[0]?.title ?? "No class saved yet."}</h3><p>{classSessionsToday[0] ? `${resourceCourses.find((course) => course.id === classSessionsToday[0].course_id)?.title ?? "Independent class"}${classSessionsToday[0].location ? ` · ${classSessionsToday[0].location}` : ""}\n${new Date(classSessionsToday[0].starts_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} – ${new Date(classSessionsToday[0].ends_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Add a lecture or lab to connect your class commitments to today's planner."}</p><span className="class-chip">{classSessionsToday.length ? `${classSessionsToday.length} TODAY` : "READY WHEN YOU ARE"}</span></article><article className="week-overview-card"><span className="section-overline">STUDY SPACE</span><h3>Find a quiet corner.</h3><p>Choose a familiar place, keep your essentials close, and protect a focused block between classes.</p><span className="class-chip">STUDY RITUAL</span></article><article className="week-overview-card"><span className="section-overline">YOUR LEARNING SPACE</span><h3>{resourceCourses.length} course{resourceCourses.length === 1 ? "" : "s"} saved</h3><p>Classes you add in Courses & sessions can be included in today's timeline and planning brief.</p><a className="text-link" href="/resources">Open learning space ↗</a></article></div></section>}
          {activeNav === "My week" && <div className="week-overview-grid"><article className="week-overview-card week-overview-feature"><span className="section-overline">A VIEW OF YOUR WEEK</span><strong>{Math.round(doneCount / Math.max(tasks.length,1)*100)}<small>%</small></strong><h3>Progress, not perfection.</h3><p>{doneCount} of {tasks.length} items completed. Keep the plan flexible and make room for rest.</p><div className="progress-bar"><span style={{width:`${doneCount / Math.max(tasks.length,1)*100}%`}}/></div></article><article className="week-overview-card"><span className="section-overline">COMING UP</span><strong>{remaining.toString().padStart(2,"0")}</strong><h3>Things still in motion</h3><p>{tasks.filter(task=>!task.done).slice(0,3).map(task=>task.title).join(" · ") || "Nothing urgent. Enjoy the space."}</p><button className="text-link" onClick={()=>navigateTo("Tasks")}>Open task list ↗</button></article><article className="week-overview-card"><span className="section-overline">A SMALL REMINDER</span><h3>Leave room for the unexpected.</h3><p>A useful plan is one you can adapt. Protect fixed commitments, and let flexible blocks move when life does.</p><button className="text-link" onClick={()=>setCommandOpen(true)}>Plan with CampusMate ↗</button></article></div>}
        </section>}
        <footer className="page-footer"><span>Made for the full life outside your to-do list.</span><span>CampusMate <i/> A little more room to think.</span><button onClick={() => announce("Thanks — feedback helps us make this better.")}>Leave a thought <span>↗</span></button></footer>
      </div>
    </section>
    {commandOpen && <div className="modal-scrim command-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-modal" role="dialog" aria-modal="true" aria-labelledby="command-title"><button className="modal-x" onClick={() => setCommandOpen(false)} aria-label="Close AI command center">CLOSE</button><div className="command-kicker"><span className="command-pulse"/> CAMPUSMATE / PLANNING STUDIO</div><h2 id="command-title">Let’s make room<br/><em>for your real life.</em></h2><p className="command-intro">Tell me what’s on your plate. I’ll shape a draft around your fixed commitments, energy, and deadlines.</p><label className="command-label" htmlFor="plan-prompt">WHAT DOES TODAY LOOK LIKE?</label><textarea id="plan-prompt" value={planPrompt} onChange={event => { setPlanPrompt(event.target.value); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); }} placeholder="I have two lectures, a physics assignment due tomorrow, and want some time to exercise…" rows={3}/><div className="command-chips"><button onClick={() => { setPlanPrompt("I’m running behind. Help me protect my classes and finish the most urgent assignment."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); }}>I’m running behind</button><button onClick={() => { setPlanPrompt("Help me balance study time, proper breaks, and a little exercise today."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); }}>Balance study & life</button><button onClick={() => { setPlanPrompt("I have an assignment due tomorrow and need a realistic plan around my lectures."); setPlanGenerated(false); setPlanAccepted(false); setPlanBrief(null); setPlanError(""); }}>Deadline tomorrow</button></div>{!planGenerated ? (
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
                  <span className="draft-badge">{planBrief.engine === "ai" ? "BEDROCK-ASSISTED" : "RULES-BASED"}</span>
                </div>
                <p className="plan-disclaimer">{planBrief.summary}</p>
                <p className="plan-disclaimer">{planBrief.reason}</p>
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
                {planAccepted && <div className="plan-accepted" role="status">Draft saved to your study plans. Your schedule has not been changed automatically.</div>}
              </div>
            ) : null}
            {planError && <p className="brief-error" role="alert">{planError}</p>}
            <div className="command-footnote">Guided mode · You approve every change · This Planning Studio draft is a demo; Daily Intelligence uses Bedrock only when enabled</div></section></div>}
    {settingsOpen && <div className="modal-scrim settings-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-x" onClick={() => setSettingsOpen(false)} aria-label="Close settings">CLOSE</button><span className="section-overline">YOUR PREFERENCES</span><h2 id="settings-title">How much help feels right?</h2><p>Choose how CampusMate handles the flexible parts of your day. You can change this whenever you like.</p><section className="appearance-settings"><div className="background-settings-heading"><span className="section-overline">APPEARANCE</span><strong>Choose your atmosphere</strong><p>A softer sky-purple night tone, without going full black. Your choice is saved on this device.</p></div><div className="tone-options"><button type="button" className={`tone-option light-tone-option ${!darkTone ? "chosen" : ""}`} onClick={() => changeTone(false)}><span className="tone-preview light-tone-preview"/><span><strong>Daylight</strong><small>Warm, airy and clear</small></span><span className="tone-radio">{!darkTone ? "SELECTED" : ""}</span></button><button type="button" className={`tone-option purple-tone-option ${darkTone ? "chosen" : ""}`} onClick={() => changeTone(true)}><span className="tone-preview purple-tone-preview"/><span><strong>Sky purple</strong><small>Dusky violet, blue and lavender</small></span><span className="tone-radio">{darkTone ? "SELECTED" : ""}</span></button></div></section><section className="background-settings"><div className="background-settings-heading"><span className="section-overline">MAKE IT YOURS</span><strong>Your background</strong><p>Upload a photo you love. It will sit behind the dashboard with a soft overlay so everything stays readable.</p></div><div className="background-preview" style={{ backgroundImage: `linear-gradient(90deg,rgba(247,245,239,.24),rgba(247,245,239,.08)),url("${backgroundImage}")` }}><span>{customBackground ? "YOUR PHOTO" : "FOLLOWS LOCAL TIME"}</span><small>{customBackground ? backgroundName || "Custom image" : `${timeLabel(localHour).toLowerCase()} · ${activeScene.name}`}</small></div><input ref={backgroundInputRef} className="background-file-input" type="file" accept="image/*" onChange={event => { void uploadBackground(event.target.files?.[0]); event.currentTarget.value = ""; }} /><div className="background-actions"><button type="button" className="background-upload-button" onClick={() => backgroundInputRef.current?.click()}>{customBackground ? "Choose another photo" : "Upload a photo"}</button>{customBackground && <button type="button" className="background-reset-button" onClick={resetBackground}>Use time-based backgrounds</button>}</div><small className="background-storage-note">Your image is saved in this browser on this device. It isn't uploaded to a server.</small></section><div className="settings-options"><button className={`settings-option ${automation === "guided" ? "selected" : ""}`} onClick={() => { setAutomation("guided"); announce("Guided mode selected"); }}><span className="settings-option-title">Guided</span><span className="settings-option-desc">Get suggestions, understand the trade-offs, and decide what changes.</span><span className="settings-option-foot">YOU STAY IN CONTROL</span></button><button className={`settings-option ${automation === "autopilot" ? "selected" : ""}`} onClick={() => { setAutomation("autopilot"); announce("Auto-pilot selected"); }}><span className="settings-option-title">Auto-pilot</span><span className="settings-option-desc">Let CampusMate rearrange flexible study blocks when your day changes. Fixed commitments stay protected.</span><span className="settings-option-foot">ROUTINE CHANGES, HANDLED</span></button></div><div className="settings-note">Important decisions—like cancelling commitments—always stay yours.</div><div className="settings-modal-actions"><button className="start-button" onClick={() => setSettingsOpen(false)}>Done <span>↗</span></button></div></section></div>}
    {addOpen && <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setAddOpen(false); }}><section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><button className="modal-x" onClick={() => { setAddOpen(false); setEditingTaskId(null); }} aria-label="Close">CLOSE</button><span className="section-overline">GET IT OUT OF YOUR HEAD</span><h2 id="add-title">{editingTaskId !== null ? "Make a small adjustment." : "What’s on your mind?"}</h2><p>{editingTaskId !== null ? "Update the details and keep your plan flexible." : "Add one thing. We’ll find a place for it later."}</p><form onSubmit={event => { event.preventDefault(); editingTaskId !== null ? saveTaskEdit() : addTask(); }}><label htmlFor="task-draft">Task or reminder</label><input autoFocus id="task-draft" value={taskDraft} onChange={event => setTaskDraft(event.target.value)} placeholder="e.g. Finish calculus problem set"/><label htmlFor="task-detail-draft">A little context</label><input id="task-detail-draft" value={taskDetailDraft} onChange={event => setTaskDetailDraft(event.target.value)} placeholder="Subject, room, deadline…"/><div className="task-form-grid"><div><label htmlFor="task-time-draft">Time</label><input id="task-time-draft" value={taskTimeDraft} onChange={event => setTaskTimeDraft(event.target.value)} placeholder="e.g. 2:30 PM"/></div><div><label htmlFor="task-priority-draft">Priority</label><select id="task-priority-draft" value={taskPriorityDraft} onChange={event => setTaskPriorityDraft(event.target.value as Task["priority"])}><option>Today</option><option>Soon</option><option>Whenever</option></select></div></div><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => {setAddOpen(false);setEditingTaskId(null)}}>Not now</button><button type="submit" className="start-button" disabled={!taskDraft.trim()}>{editingTaskId !== null ? "Save changes" : "Add to my list"} <span>↗</span></button></div></form></section></div>}
    {toast && <div className="toast"><span className="toast-check">NOTE</span>{toast}<button onClick={() => setToast("")} aria-label="Dismiss">DISMISS</button></div>}
  </main>;
}
