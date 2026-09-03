import type { Database } from "@/lib/database-types";

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type Sprint = Database["public"]["Tables"]["sprints"]["Row"];
export type Milestone = Database["public"]["Tables"]["milestones"]["Row"];
export type Label = Database["public"]["Tables"]["labels"]["Row"];

export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type SprintStatus = Database["public"]["Enums"]["sprint_status"];
export type MilestoneStatus = Database["public"]["Enums"]["milestone_status"];

export const TASK_STATUSES: { value: TaskStatus; label: string; color: string }[] = [
  { value: "backlog", label: "Backlog", color: "bg-muted text-muted-foreground" },
  { value: "todo", label: "To do", color: "bg-slate-500/20 text-slate-300" },
  { value: "in_progress", label: "In progress", color: "bg-blue-500/20 text-blue-300" },
  { value: "in_review", label: "In review", color: "bg-purple-500/20 text-purple-300" },
  { value: "done", label: "Done", color: "bg-emerald-500/20 text-emerald-300" },
  { value: "cancelled", label: "Cancelled", color: "bg-zinc-500/15 text-zinc-400 line-through" },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "text-slate-400" },
  { value: "medium", label: "Medium", color: "text-blue-400" },
  { value: "high", label: "High", color: "text-amber-400" },
  { value: "urgent", label: "Urgent", color: "text-red-400" },
];

export const PROJECT_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6",
];

export function slugifyKey(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "PROJ";
}
