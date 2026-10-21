export type PlannerPriority = "Today" | "Soon" | "Whenever";
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
