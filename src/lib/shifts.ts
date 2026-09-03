import type { Database } from "@/lib/database-types";

export type Shift = Database["public"]["Tables"]["shifts"]["Row"];
export type ShiftType = Database["public"]["Tables"]["shift_types"]["Row"];
export type ShiftSettings = Database["public"]["Tables"]["shift_settings"]["Row"];
export type SwapRequest = Database["public"]["Tables"]["shift_swap_requests"]["Row"];
export type ShiftStatus = Database["public"]["Enums"]["shift_status"];
export type SwapKind = Database["public"]["Enums"]["swap_kind"];
export type SwapStatus = Database["public"]["Enums"]["swap_status"];

export function initials(name?: string | null, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || fallback;
}

export function colorForUser(id: string) {
  const palette = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

export function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayShiftAtRange(day: Date, startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const start = new Date(day);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(day);
  end.setHours(eh, em, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1); // overnight
  return { start_at: start.toISOString(), end_at: end.toISOString() };
}

export function isOnShiftNow(s: Pick<Shift, "start_at" | "end_at" | "status">) {
  if (s.status === "ended" || s.status === "cancelled") return false;
  const now = Date.now();
  return new Date(s.start_at).getTime() <= now && now <= new Date(s.end_at).getTime();
}

export function addMonths(d: Date, n: number) {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}
