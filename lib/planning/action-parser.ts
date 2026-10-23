import { findDuplicatePlanningTask } from "./duplicate-task";

export type ActionTaskPriority = "Low" | "Medium" | "High";

export type ActionTaskProposal = {
  title: string;
  detail: string;
  priority: ActionTaskPriority;
  durationMinutes: number;
  duration: string;
  durationEstimated: boolean;
  deadlineDate: string;
  deadlineTime: string;
  scheduledDate: string;
  targetDate: string;
  startTime: string;
  endTime: string;
  time: string;
  canSchedule: boolean;
  schedulingNote: string;
  courseId: string | null;
  courseTitle: string | null;
};

type ExistingTask = {
  title?: string;
  courseId?: string | null;
  deadlineDate?: string | null;
  deadlineTime?: string | null;
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  done?: boolean;
  kind?: string;
};
type ExistingClass = { starts_at?: string; ends_at?: string; course_id?: string | null; title?: string };
type ExistingCourse = { id: string; title: string; course_code?: string | null };
type ParseOptions = {
  now?: Date;
  preferredStart?: string;
  preferredEnd?: string;
  tasks?: ExistingTask[];
  classes?: ExistingClass[];
  courses?: ExistingCourse[];
};

const numberWords: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5,
};
const actionVerbs = ["finish", "complete", "submit", "prepare", "study for", "study", "work on", "write", "review", "solve", "revise", "read", "practice", "do"];

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]); const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
function minutesToTime(value: number): string {
  const safe = Math.max(0, Math.min(1439, value));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
function timeLabel(value: string): string {
  const minutes = timeToMinutes(value);
  if (minutes === null) return "Not scheduled";
  const hour = Math.floor(minutes / 60); const minute = minutes % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? "" : "s"}`;
  if (minutes > 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} min`;
}
function parseDuration(prompt: string): number {
  const match = prompt.match(/\b(?:it\s+(?:will\s+)?take|takes?|taking|spend|for|around|about|approximately|roughly)?\s*(\d+(?:\.\d+)?|one|a|an|two|three|four|five|six|seven|eight|nine|ten|half)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (!match) return 60;
  const amount = Number(match[1]) || numberWords[match[1].toLowerCase()] || 1;
  const minutes = /h|hour/i.test(match[2]) ? amount * 60 : amount;
  return Math.max(15, Math.min(8 * 60, Math.round(minutes / 15) * 15));
}
function findTaskTitle(prompt: string): string | null {
  const verbPattern = new RegExp(`\\b(${actionVerbs.map((verb) => verb.replace(/ /g, "\\s+")).join("|")})\\s+(.+)`, "i");
  const actionMatch = prompt.match(verbPattern);
  if (actionMatch) {
    const verb = actionMatch[1].replace(/\s+/g, " ").toLowerCase();
    const object = actionMatch[2]
      .split(/\s+(?:by|before|due(?:\s+by)?|deadline|no\s+later\s+than|it\s+will\s+take|it\'ll\s+take|it\s+takes|taking|which\s+will\s+take)\b|[,;.!?\n]/i)[0]
      .replace(/\s+(?:for\s+)?(?:around\s+|about\s+|approximately\s+|roughly\s+)?(?:\d+(?:\.\d+)?|one|a|an|two|three|four|five|six|seven|eight|nine|ten|half)\s*(?:hours?|hrs?|minutes?|mins?)\b.*$/i, "")
      .replace(/\s+(?:today|tonight|tomorrow|this\s+evening|this\s+afternoon|this\s+weekend)$/i, "")
      .replace(/\b(?:around|about|approximately|roughly)\s+\d+.*$/i, "")
      .trim();
    if (object && object.length >= 2) {
      const cleanObject = object.replace(/^(?:my|the|a|an)\s+/i, "").trim();
      // A bare "study time" in a general wellness/planning prompt is not a
      // concrete task. Keep bare "study" actionable for subjects/topics such
      // as "study DSA tomorrow" without turning "balance study time" into one.
      const vagueStudyObject = verb === "study" && /^(?:time|session|sessions|break|breaks|today|tomorrow|tonight|my day|the day|my week|the week|schedule|my schedule|the schedule)$/i.test(cleanObject);
      if (!vagueStudyObject) {
        const title = `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${cleanObject}`.replace(/\s+/g, " ").trim();
        if (title.length >= 4 && title.length <= 180) return title;
      }
    }
  }

  // Handle requests such as “I have a physics assignment due tomorrow” even
  // when the student did not phrase it as an imperative. Capture the task noun
  // separately, then keep only the useful subject words immediately before it.
  const nounMatch = prompt.match(/\b(assignment|homework|project|report|lab(?:\s+work)?|essay|worksheet|problem\s+set|presentation|exam|quiz|submission|notes|practice\s+problems)\b/i);
  if (nounMatch && nounMatch.index !== undefined) {
    const prefix = prompt.slice(Math.max(0, nounMatch.index - 65), nounMatch.index);
    let subject = prefix.split(/[,;.!?\n]/).pop()?.trim() ?? "";
    subject = subject
      .replace(/^(?:(?:i|we)\s+)?(?:have|has|need|got|want|must|should)\s+(?:(?:to\s+)?(?:a|an|the|my|our)\s+)?/i, "")
      .replace(/^(?:i|we)\s+(?:have|need|want)(?:\s+(?:a|an|the|my|our))?$/i, "")
      .replace(/^(?:i\s+have\s+to\s+|i\s+need\s+to\s+|i\s+want\s+to\s+)/i, "")
      .replace(/\b(?:due|by|before|deadline|and|but|then|today|tomorrow|tonight)\b.*$/i, "")
      .replace(/^(?:a|an|the|my|our|i|we)\s+/i, "")
      .replace(/^(?:a|an|the|my|our)$/i, "")
      .replace(/[^a-z0-9' -]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = subject.split(/\s+/).filter(Boolean).slice(-3);
    const cleanedSubject = words.join(" ");
    const candidate = `${cleanedSubject ? `${cleanedSubject} ` : ""}${nounMatch[1]}`.replace(/\s+/g, " ").trim();
    if (candidate.length >= 3) return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  }
  return null;
}
function parseDate(prompt: string, now: Date): string {
  const lower = prompt.toLowerCase();
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && Number.isFinite(new Date(`${iso[1]}T12:00:00`).getTime())) return iso[1];
  if (/\bday after tomorrow\b/.test(lower)) return localDateKey(addDays(now, 2));
  if (/\btomorrow\b/.test(lower)) return localDateKey(addDays(now, 1));
  if (/\btoday\b|\btonight\b|\bthis evening\b/.test(lower)) return localDateKey(now);

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekdayMatch = lower.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const target = weekdays.indexOf(weekdayMatch[1]);
    const offset = (target - now.getDay() + 7) % 7;
    return localDateKey(addDays(now, offset));
  }
  return "";
}
function parseDeadlineTime(prompt: string): string {
  const datePhrase = "(?:(?:today|tonight|tomorrow|day\\s+after\\s+tomorrow|(?:on\\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\\s+)?";
  const cue = "(?:by|before|due(?:\\s+by)?|deadline(?:\\s+is)?|no\\s+later\\s+than)\\s+";
  const meridiemPattern = new RegExp(`\\b${cue}${datePhrase}(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)\\b`, "i");
  const chosen = prompt.match(meridiemPattern);
  if (chosen) {
    let hour = Number(chosen[1]); const minute = Number(chosen[2] ?? 0); const suffix = chosen[3].toLowerCase().startsWith("p") ? "pm" : "am";
    if (hour < 1 || hour > 12 || minute > 59) return "";
    if (suffix === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return minutesToTime(hour * 60 + minute);
  }
  const militaryPattern = new RegExp(`\\b${cue}${datePhrase}(?:at\\s+)?(\\d{1,2}):(\\d{2})\\b`, "i");
  const military = prompt.match(militaryPattern);
  if (military) {
    const hour = Number(military[1]); const minute = Number(military[2]);
    if (hour >= 0 && hour <= 23 && minute <= 59) return minutesToTime(hour * 60 + minute);
  }
  return "";
}

function durationFromLabel(value = ""): number {
  const match = value.match(/(\d+)\s*(min(?:ute)?s?|h|hr|hours?)/i);
  if (!match) return 30;
  return /h|hour/i.test(match[2]) ? Number(match[1]) * 60 : Number(match[1]);
}
function localMinutesFromIso(value?: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}


const subjectGroups: string[][] = [
  ["physics", "phys"], ["chemistry", "chem"], ["mathematics", "maths", "math", "calculus"],
  ["computer science", "cse", "programming", "dsa", "data structures", "algorithms"],
  ["electronics", "electrical", "circuits", "basic electrical"], ["mechanics", "engineering mechanics"],
  ["environmental science", "evs", "environment"], ["communication skills", "english", "technical writing"],
  ["statistics", "probability"], ["biology", "biological science"], ["thermodynamics", "thermal engineering"],
];
function normalizedWords(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function containsPhrase(source: string, phrase: string): boolean {
  const normalizedSource = ` ${normalizedWords(source)} `;
  const normalizedPhrase = normalizedWords(phrase);
  return Boolean(normalizedPhrase && normalizedSource.includes(` ${normalizedPhrase} `));
}
function matchCourse(prompt: string, taskTitle: string, courses: ExistingCourse[] = []): ExistingCourse | null {
  if (!courses.length) return null;
  const source = `${prompt} ${taskTitle}`;
  // Prefer an explicit course title or course code mentioned by the student.
  const explicit = courses
    .filter((course) => [course.title, course.course_code ?? ""].some((value) => value.trim() && containsPhrase(prompt, value)))
    .sort((a, b) => normalizedWords(b.title).length - normalizedWords(a.title).length);
  if (explicit.length) return explicit[0];

  // For natural requests such as "physics assignment", match only well-known
  // subject words shared by the request and a saved course title. If multiple
  // courses could match, leave the link empty so the student can choose.
  const subjectMatches = courses.filter((course) => subjectGroups.some((group) =>
    group.some((term) => containsPhrase(source, term)) && group.some((term) => containsPhrase(course.title, term) || containsPhrase(course.course_code ?? "", term))
  ));
  if (subjectMatches.length === 1) return subjectMatches[0];
  if (subjectMatches.length > 1) return null;

  const generic = new Set(["a", "an", "the", "my", "our", "assignment", "homework", "project", "report", "lab", "work", "task", "finish", "complete", "submit", "prepare", "write", "study", "review", "today", "tomorrow"]);
  const requestWords = new Set(normalizedWords(source).split(" ").filter((word) => word.length > 3 && !generic.has(word)));
  const loose = courses.filter((course) => normalizedWords(course.title).split(" ").some((word) => requestWords.has(word) && !generic.has(word)));
  return loose.length === 1 ? loose[0] : null;
}

function findAvailableBlock(options: {
  now: Date;
  durationMinutes: number;
  targetDate: string;
  deadlineDate: string;
  deadlineTime: string;
  preferredStart: string;
  preferredEnd: string;
  tasks: ExistingTask[];
  classes: ExistingClass[];
}): { date: string; start: string; end: string } | null {
  const { now, durationMinutes, targetDate, deadlineDate, deadlineTime, preferredStart, preferredEnd, tasks, classes } = options;
  const todayKey = localDateKey(now);
  const firstDateKey = targetDate || todayKey;
  if (firstDateKey < todayKey || (deadlineDate && deadlineDate < todayKey) || (deadlineDate && firstDateKey > deadlineDate)) return null;

  const firstDate = new Date(`${firstDateKey}T12:00:00`);
  if (!Number.isFinite(firstDate.getTime())) return null;
  // Search later dates when today's calendar is full, but never schedule beyond
  // a known deadline. For tasks without a deadline, look ahead one week.
  const lastDateKey = deadlineDate || localDateKey(addDays(firstDate, 6));
  const preferredStartMinute = timeToMinutes(preferredStart) ?? 17 * 60;
  const preferredEndMinute = timeToMinutes(preferredEnd) ?? 21 * 60;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const date = addDays(firstDate, dayOffset);
    const scheduleDate = localDateKey(date);
    if (scheduleDate > lastDateKey || (deadlineDate && scheduleDate > deadlineDate)) break;

    const isToday = scheduleDate === todayKey;
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const windowStart = isToday
      ? Math.max(preferredStartMinute, Math.ceil((nowMinute + 15) / 15) * 15)
      : preferredStartMinute;
    const dueMinute = deadlineDate === scheduleDate && deadlineTime ? timeToMinutes(deadlineTime) : null;
    let windowEnd = dueMinute === null ? preferredEndMinute : Math.min(preferredEndMinute, dueMinute);
    if (windowStart + durationMinutes > windowEnd && dueMinute !== null && dueMinute > windowStart) {
      // If the preferred window is too short, use the remaining time before
      // the deadline instead of proposing a block that runs past it.
      windowEnd = dueMinute;
    }
    if (windowStart > windowEnd || windowStart + durationMinutes > windowEnd) continue;

    const busy: Array<{ start: number; end: number }> = [];
    for (const task of tasks) {
      // A completed item can still have a visible saved calendar block. Treat
      // that persisted block as occupied until the user explicitly reschedules
      // or removes it; this keeps the proposal preview consistent with Schedule.
      if (task.scheduledDate !== scheduleDate || !task.startTime) continue;
      const start = timeToMinutes(task.startTime);
      if (start === null) continue;
      const end = timeToMinutes(task.endTime ?? "") ?? (start + durationFromLabel(task.duration));
      if (end > start) busy.push({ start, end });
    }
    for (const session of classes) {
      const startDate = session.starts_at ? new Date(session.starts_at) : null;
      const endDate = session.ends_at ? new Date(session.ends_at) : null;
      if (!startDate || !endDate || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || localDateKey(startDate) !== scheduleDate) continue;
      const start = localMinutesFromIso(session.starts_at);
      const end = localMinutesFromIso(session.ends_at);
      if (start !== null && end !== null && end > start) busy.push({ start, end });
    }
    busy.sort((a, b) => a.start - b.start);
    for (let start = windowStart; start + durationMinutes <= windowEnd; start += 15) {
      const end = start + durationMinutes;
      if (!busy.some((slot) => start < slot.end && end > slot.start)) {
        return { date: scheduleDate, start: minutesToTime(start), end: minutesToTime(end) };
      }
    }
  }
  return null;
}

/**
 * Extracts one explicit task request from a Planning Studio prompt and proposes
 * a safe schedule block. It does not write anything; the student confirms the
 * proposal in the UI before a task is created.
 */
export function parseTaskIntent(prompt: string, options: ParseOptions = {}): ActionTaskProposal | null {
  const raw = prompt.trim();
  if (!raw) return null;
  const title = findTaskTitle(raw);
  if (!title) return null;

  const now = options.now ? new Date(options.now) : new Date();
  const mentionedDate = parseDate(raw, now);
  const deadlineTime = parseDeadlineTime(raw);
  const hasDeadlineCue = /\b(?:by|before|due(?:\s+by)?|deadline|no\s+later\s+than)\b/i.test(raw);
  const todayKey = localDateKey(now);
  const deadlineDate = hasDeadlineCue ? (mentionedDate || (deadlineTime ? todayKey : "")) : (deadlineTime ? todayKey : "");
  const targetDate = !hasDeadlineCue && mentionedDate ? mentionedDate : todayKey;
  const explicitDuration = /\b(?:\d+(?:\.\d+)?|one|a|an|two|three|four|five|six|seven|eight|nine|ten|half)\s*(?:hours?|hrs?|minutes?|mins?)\b/i.test(raw);
  const durationMinutes = parseDuration(raw);
  const dueIsUrgent = Boolean(deadlineDate && deadlineDate <= localDateKey(addDays(now, 1)));
  const priority: ActionTaskPriority = dueIsUrgent ? "High" : /\b(urgent|important|high[- ]priority|asap)\b/i.test(raw) ? "High" : "Medium";
  const linkedCourse = matchCourse(raw, title, options.courses ?? []);
  const block = findAvailableBlock({
    now,
    durationMinutes,
    targetDate,
    deadlineDate,
    deadlineTime,
    preferredStart: options.preferredStart ?? "17:00",
    preferredEnd: options.preferredEnd ?? "21:00",
    tasks: options.tasks ?? [],
    classes: options.classes ?? [],
  });
  const detail = `Created from your Planning Studio request: “${raw.slice(0, 220)}${raw.length > 220 ? "…" : ""}”`;
  return {
    title,
    detail,
    priority,
    durationMinutes,
    duration: durationLabel(durationMinutes),
    durationEstimated: !explicitDuration,
    deadlineDate,
    deadlineTime,
    scheduledDate: block?.date ?? "",
    targetDate,
    startTime: block?.start ?? "",
    endTime: block?.end ?? "",
    time: block ? timeLabel(block.start) : "Not scheduled",
    canSchedule: Boolean(block),
    schedulingNote: block
      ? `Suggested ${timeLabel(block.start)}–${timeLabel(block.end)} on ${block.date}, using your preferred study window and existing class/task commitments.${linkedCourse ? ` Linked to ${linkedCourse.title}.` : " Saved class sessions are treated as fixed commitments."}`
      : `I found the task and deadline, but no conflict-free block before the deadline. You can still add it to Tasks without a time and schedule it later.${linkedCourse ? ` The task can be linked to ${linkedCourse.title}.` : ""}`,
    courseId: linkedCourse?.id ?? null,
    courseTitle: linkedCourse?.title ?? null,
  };
}

const taskIntentStarter = String.raw`(?:(?:i|we)\s+(?:(?:also|still)\s+)?(?:need|have|want|must|should|plan|intend)\s+(?:to\s+)?|(?:finish|complete|submit|prepare|study\s+for|study|work\s+on|write|review|solve|revise|read|practice|do|remind\s+me\s+to)\b)`;

/** Split a natural-language request into task-sized clauses without breaking
 * supporting phrases such as "It will take two hours" away from the task. */
export function splitTaskIntentClauses(prompt: string): string[] {
  const input = prompt
    .replace(/\r/g, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "\n")
    .trim();
  if (!input) return [];

  const sentenceBoundary = new RegExp(`[.!?]\\s+(?=(?:also\\s+|then\\s+|next\\s+|finally\\s+)?${taskIntentStarter})`, "gi");
  const lines = input.split(/\n+|;+|(?<=\.)\s+(?=(?:also|then|next|finally)\b)/i);
  const candidates: string[] = [];
  for (const line of lines) {
    const cleanedLine = line.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    if (!cleanedLine) continue;
    const sentences = cleanedLine.split(sentenceBoundary).map((part) => part.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const pieces = sentence.split(new RegExp(`(?:,\\s*|\\s+(?:and then|and|also|then)\\s+)(?=${taskIntentStarter})`, "gi"));
      candidates.push(...pieces.map((part) => part.trim()).filter(Boolean));
    }
  }

  // Attach non-action follow-up context to the previous clause, e.g. duration hints.
  const merged: string[] = [];
  for (const candidate of candidates) {
    if (merged.length && !new RegExp(`^${taskIntentStarter}`, "i").test(candidate) && !findTaskTitle(candidate)) {
      merged[merged.length - 1] += `. ${candidate}`;
    } else {
      merged.push(candidate);
    }
  }
  return merged.map((part) => part.replace(/[;,\s.!?]+$/g, "").trim()).filter(Boolean).slice(0, 8);
}

/** Extract task actions, skip existing duplicates, and reserve only valid new blocks. */
export function parseTaskIntents(prompt: string, options: ParseOptions = {}): ActionTaskProposal[] {
  const clauses = splitTaskIntentClauses(prompt);
  if (clauses.length <= 1) {
    const single = parseTaskIntent(prompt, options);
    return single ? [single] : [];
  }

  const proposals: ActionTaskProposal[] = [];
  const occupiedTasks: ExistingTask[] = [...(options.tasks ?? [])];
  for (const clause of clauses) {
    const parsed = parseTaskIntent(clause, { ...options, tasks: occupiedTasks });
    if (!parsed) continue;
    const key = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (proposals.some((item) => item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key
      && item.deadlineDate === parsed.deadlineDate && item.courseId === parsed.courseId)) continue;

    const identityTasks = occupiedTasks.filter((task): task is ExistingTask & { title: string } => typeof task.title === "string" && Boolean(task.title.trim()));
    const duplicate = findDuplicatePlanningTask(identityTasks, parsed);
    if (duplicate) {
      // A duplicate is already present. Do not display or reserve a new block for it,
      // and inherit the saved course link when extraction didn't infer one.
      const courseId = parsed.courseId ?? duplicate.courseId ?? null;
      const course = (options.courses ?? []).find((candidate) => candidate.id === courseId);
      const skipped: ActionTaskProposal = {
        ...parsed,
        courseId,
        courseTitle: course?.title ?? parsed.courseTitle,
        scheduledDate: "",
        startTime: "",
        endTime: "",
        time: "Not scheduled",
        canSchedule: false,
        schedulingNote: `“${duplicate.title}” already exists${duplicate.done ? " and is complete" : ""}. This batch item will be skipped to avoid a duplicate.`,
      };
      proposals.push(skipped);
      continue;
    }

    // Recompute at the batch boundary using the entire occupied set. This is a
    // final guard against stale/conflicting initial suggestions from the parser.
    const proposal = rescheduleTaskProposal(parsed, { ...options, tasks: occupiedTasks });
    proposals.push(proposal);
    // Add its identity even when no time is available; scheduled fields are blank
    // in that case, so it won't block other time slots but can still catch duplicates.
    occupiedTasks.push({
      title: proposal.title,
      courseId: proposal.courseId,
      deadlineDate: proposal.deadlineDate,
      deadlineTime: proposal.deadlineTime,
      scheduledDate: proposal.canSchedule ? proposal.scheduledDate : "",
      startTime: proposal.canSchedule ? proposal.startTime : "",
      endTime: proposal.canSchedule ? proposal.endTime : "",
      duration: proposal.duration,
      done: false,
      kind: "study",
    });
  }
  return proposals.slice(0, 8);
}

/** Recompute a proposal after editing its duration or deadline in batch review. */
export function rescheduleTaskProposal(proposal: ActionTaskProposal, options: ParseOptions = {}): ActionTaskProposal {
  const now = options.now ? new Date(options.now) : new Date();
  const durationMinutes = Math.max(15, Math.min(8 * 60, Math.round(proposal.durationMinutes / 15) * 15));
  const targetDate = proposal.targetDate || proposal.scheduledDate || proposal.deadlineDate || localDateKey(now);
  const block = findAvailableBlock({
    now, targetDate, durationMinutes, deadlineDate: proposal.deadlineDate, deadlineTime: proposal.deadlineTime,
    preferredStart: options.preferredStart ?? "17:00", preferredEnd: options.preferredEnd ?? "21:00",
    tasks: options.tasks ?? [], classes: options.classes ?? [],
  });
  const course = (options.courses ?? []).find((candidate) => candidate.id === proposal.courseId);
  return {
    ...proposal, durationMinutes, duration: durationLabel(durationMinutes),
    scheduledDate: block?.date ?? "", targetDate, startTime: block?.start ?? "", endTime: block?.end ?? "",
    time: block ? timeLabel(block.start) : "Not scheduled", canSchedule: Boolean(block),
    courseTitle: course?.title ?? proposal.courseTitle,
    schedulingNote: block
      ? `Suggested ${timeLabel(block.start)}–${timeLabel(block.end)} on ${block.date}, using your preferred study window and existing class/task commitments.${course ? ` Linked to ${course.title}.` : ""}`
      : `No conflict-free ${durationLabel(durationMinutes)} block was found for ${targetDate}. You can still add this task without a scheduled time.${course ? ` Linked to ${course.title}.` : ""}`,
  };
}
