/**
 * Helpers for guarding AI-created tasks against accidental duplicates.
 * Unicode dash/punctuation differences and a trailing “Demo” label are ignored.
 */
export type PlanningTaskIdentity = {
  title: string;
  courseId?: string | null;
  deadlineDate?: string | null;
  deadlineTime?: string | null;
};

export function normalizePlanningTaskTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s*[-–—:|]?\s*(?:test\s+copy|demo|copy)\s*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Returns an existing task when the proposed title is the same after benign
 * formatting cleanup, unless an explicit different due date or course suggests
 * that it is a separate occurrence. Completed tasks are included intentionally.
 */
export function findDuplicatePlanningTask<T extends PlanningTaskIdentity>(
  tasks: readonly T[],
  proposal: PlanningTaskIdentity,
): T | undefined {
  const proposedTitle = normalizePlanningTaskTitle(proposal.title);
  if (!proposedTitle) return undefined;

  return tasks.find((task) => {
    if (normalizePlanningTaskTitle(task.title) !== proposedTitle) return false;
    if (task.deadlineDate && proposal.deadlineDate && task.deadlineDate !== proposal.deadlineDate) return false;
    if (task.courseId && proposal.courseId && task.courseId !== proposal.courseId) return false;
    return true;
  });
}
