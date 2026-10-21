import type { DailyBrief, PlannerTask } from "./types";

const priorityScore: Record<PlannerTask["priority"], number> = {
  Today: 0,
  Soon: 1,
  Whenever: 2,
};

function durationMinutes(value: string): number {
  const match = value.match(/(\d+)\s*(min|minute|hr|hour)/i);
  if (!match) return 30;
  const amount = Number(match[1]);
  return /hr|hour/i.test(match[2]) ? amount * 60 : amount;
}

/** A predictable fallback planner. It never invents deadlines or class times. */
export function buildRuleBasedBrief(tasks: PlannerTask[], context = ""): DailyBrief {
  const openTasks = tasks.filter((task) => !task.done);
  const flexibleTasks = openTasks.filter((task) => task.kind !== "class");
  const ordered = [...flexibleTasks].sort((a, b) => {
    const priorityDelta = priorityScore[a.priority] - priorityScore[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return durationMinutes(a.duration) - durationMinutes(b.duration);
  });
  // Fixed classes are commitments to protect, not work items to recommend as
  // the student's next action. If no flexible task remains, say that clearly.
  const priorityTask = ordered[0] ?? null;
  const onlyFixedCommitments = openTasks.length > 0 && flexibleTasks.length === 0;
  const urgentCount = openTasks.filter((task) => task.priority === "Today").length;
  const studyCount = openTasks.filter((task) => task.kind === "study").length;
  const doneCount = tasks.length - openTasks.length;
  const contextLine = context.trim();

  const summary = openTasks.length === 0
    ? "Your list is clear. Keep the space open, or use a little of it for rest and a quick look at tomorrow."
    : onlyFixedCommitments
      ? `You have ${openTasks.length} fixed ${openTasks.length === 1 ? "commitment" : "commitments"} left. Keep those times protected and leave a little room around them.`
      : `You have ${openTasks.length} open ${openTasks.length === 1 ? "item" : "items"}${urgentCount ? `, including ${urgentCount} marked for today` : ""}. Protect fixed commitments first, then give one flexible task your attention.`;

  let reason = "Start with one manageable step, then reassess instead of trying to solve the whole day at once.";
  if (onlyFixedCommitments) {
    reason = "Your remaining items are fixed commitments. Keep their scheduled times protected, allow for transitions, and use only the open windows around them for flexible work or rest.";
  } else if (priorityTask?.priority === "Today") {
    reason = `You marked this for today${priorityTask.kind === "study" ? ", and it is an academic task" : ""}. Giving it a focused block now reduces the number of urgent decisions later.`;
  } else if (priorityTask?.priority === "Soon") {
    reason = "Nothing else in your open list has a higher priority. A small start now can keep this from becoming tomorrow's rush.";
  } else if (!priorityTask) {
    reason = "There is no unfinished task to push forward. Protect the breathing room rather than adding busywork.";
  }
  if (contextLine) {
    reason += ` Your note is included: “${contextLine.slice(0, 180)}”. Treat it as a constraint when you shape the day.`;
  }

  const focusMinutes = priorityTask ? Math.min(50, Math.max(20, durationMinutes(priorityTask.duration))) : 20;
  const fixedTask = openTasks.find((task) => task.kind === "class") ?? null;
  const plan = priorityTask
    ? [
        { time: priorityTask.time === "Not scheduled" ? "Next open block" : priorityTask.time, title: `Start: ${priorityTask.title}`, detail: `${focusMinutes}-minute focused block; keep the first step small.` },
        { time: "After the block", title: "Take a proper reset", detail: "Step away for water, food, or a short walk before choosing what comes next." },
        { time: "Then reassess", title: studyCount > 1 ? "Choose the next academic task" : "Review what remains", detail: "Re-check your remaining tasks and fixed commitments before changing the plan." },
      ]
    : onlyFixedCommitments && fixedTask
      ? [
          { time: fixedTask.time === "Not scheduled" ? "Scheduled time" : fixedTask.time, title: `Protect: ${fixedTask.title}`, detail: "Keep this fixed commitment in place; do not schedule study work over it." },
          { time: "Between commitments", title: "Leave transition space", detail: "Allow time to move between classes, eat, or reset rather than filling every minute." },
          { time: "Open windows", title: "Reassess what fits", detail: "Only add flexible study work if a realistic open block remains." },
        ]
      : [
          { time: "First", title: "Keep the space", detail: "No unfinished task needs to be added just to fill the day." },
          { time: "Later", title: "Look at tomorrow", detail: "A two-minute scan can make the next morning calmer." },
          { time: "Whenever", title: "Take a real break", detail: "Rest is a valid use of a clear schedule." },
        ];

  return {
    headline: priorityTask ? "One clear place to begin." : onlyFixedCommitments ? "Protect the fixed parts of today." : "Room to breathe.",
    summary: `${summary}${doneCount ? ` You have already finished ${doneCount} ${doneCount === 1 ? "item" : "items"}.` : ""}`,
    priorityTaskId: priorityTask ? String(priorityTask.id) : null,
    priorityTitle: priorityTask?.title ?? (onlyFixedCommitments ? "Keep fixed commitments protected" : "Nothing urgent is waiting"),
    reason,
    nextSteps: priorityTask
      ? ["Protect fixed classes or appointments first.", `Give “${priorityTask.title}” one focused block.`, "Take a break, then decide what deserves attention next."]
      : onlyFixedCommitments
        ? ["Keep scheduled classes and appointments protected.", "Leave breathing room for travel and transitions.", "Use only genuinely open windows for extra work."]
        : ["Keep your calendar clear of unnecessary tasks.", "Take a quick look at tomorrow's commitments.", "Use the extra space to rest or reset."],
    plan,
    engine: "rules",
  };
}

export function sanitizePlannerTasks(value: unknown): PlannerTask[] {
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error("Send an array of up to 40 planner tasks.");
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Task ${index + 1} is invalid.`);
    const task = raw as Record<string, unknown>;
    const title = typeof task.title === "string" ? task.title.trim().slice(0, 180) : "";
    if (!title) throw new Error(`Task ${index + 1} needs a title.`);
    const priority = task.priority === "Today" || task.priority === "Soon" || task.priority === "Whenever" ? task.priority : "Soon";
    const kind = task.kind === "class" || task.kind === "life" || task.kind === "study" ? task.kind : "study";
    return {
      id: typeof task.id === "string" || typeof task.id === "number" ? String(task.id).slice(0, 80) : String(index + 1),
      title,
      detail: typeof task.detail === "string" ? task.detail.trim().slice(0, 300) : "",
      time: typeof task.time === "string" ? task.time.trim().slice(0, 40) : "Not scheduled",
      duration: typeof task.duration === "string" ? task.duration.trim().slice(0, 40) : "30 min",
      priority,
      done: task.done === true,
      kind,
    };
  });
}
