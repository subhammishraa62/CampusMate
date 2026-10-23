export type PlannerPriority = "Low" | "Medium" | "High";
export type PlannerKind = "study" | "class" | "life";

export type PlannerTask = {
  id: string | number;
  title: string;
  detail: string;
  time: string;
  duration: string;
  priority: PlannerPriority;
  done: boolean;
  kind: PlannerKind;
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  deadlineDate?: string;
  deadlineTime?: string;
  reminderMinutes?: number | null;
  courseId?: string | null;
};

export type BriefPlanItem = {
  time: string;
  title: string;
  detail: string;
};

export type DailyBrief = {
  headline: string;
  summary: string;
  priorityTaskId: string | null;
  priorityTitle: string;
  reason: string;
  nextSteps: string[];
  plan: BriefPlanItem[];
  engine: "rules" | "ai";
  note?: string;
  generatedAt?: string;
};
