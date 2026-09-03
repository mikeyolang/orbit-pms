import { useCallback, useEffect, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ShiftType, ShiftSettings } from "@/lib/shifts";

export function ShiftSettingsPanel({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  type ExtendedSettings = ShiftSettings & { hr_integration_enabled?: boolean; hr_system_name?: string | null; hr_webhook_url?: string | null };
  const [settings, setSettings] = useState<ExtendedSettings | null>(null);
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: t }] = await Promise.all([
      postgres.from("shift_settings").select("*").eq("organization_id", orgId).maybeSingle(),
      postgres.from("shift_types").select("*").eq("organization_id", orgId).order("sort_order"),
    ]);
    setSettings(s as ExtendedSettings | null);
    setTypes(t ?? []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function updateSetting(patch: Partial<ExtendedSettings>) {
    if (!settings) return;
    const { error } = await postgres.from("shift_settings").update(patch).eq("id", settings.id);
    if (error) return toast.error(error.message);
    setSettings({ ...settings, ...patch });
  }

  async function updateType(id: string, patch: Partial<ShiftType>) {
    const { error } = await postgres.from("shift_types").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function addType() {
    const key = `custom_${Date.now().toString(36).slice(-4)}`;
    const { data, error } = await postgres.from("shift_types").insert({
      organization_id: orgId, key, label: "New shift", color: "#8b5cf6",
      start_time: "09:00", end_time: "17:00", sort_order: types.length,
    }).select().single();
    if (error) return toast.error(error.message);
    setTypes((prev) => [...prev, data as ShiftType]);
  }

  async function removeType(id: string) {
    if (!confirm("Delete this shift type?")) return;
    const { error } = await postgres.from("shift_types").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setTypes((prev) => prev.filter((t) => t.id !== id));
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">General</h3>
        <div className="mt-4 space-y-3">
          <Toggle label="Auto-copy previous week/month by default"
                  checked={!!settings?.auto_copy_enabled}
                  disabled={!canManage}
                  onChange={(v) => updateSetting({ auto_copy_enabled: v })} />
          <Toggle label="Require manager approval for swaps"
                  checked={!!settings?.manager_approval_required}
                  disabled={!canManage}
                  onChange={(v) => updateSetting({ manager_approval_required: v })} />
          <Toggle label="Members can see everyone's shifts"
                  checked={settings?.members_see_all_shifts !== false}
                  disabled={!canManage}
                  onChange={(v) => updateSetting({ members_see_all_shifts: v })} />
          <Toggle label="Allow half shifts"
                  checked={!!settings?.allow_half_shifts}
                  disabled={!canManage}
                  onChange={(v) => updateSetting({ allow_half_shifts: v })} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">HR absence integration</h3>
        <p className="mt-1 text-xs text-muted-foreground">Forward newly reported absences to an HR system that accepts secure webhooks.</p>
        <div className="mt-4 space-y-3">
          <Toggle label="Send absence reports to HR" checked={!!settings?.hr_integration_enabled} disabled={!canManage} onChange={(v) => updateSetting({ hr_integration_enabled: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs text-muted-foreground">HR system name</Label><Input value={settings?.hr_system_name ?? ""} disabled={!canManage} placeholder="e.g. BambooHR" onChange={(e) => setSettings(settings ? { ...settings, hr_system_name: e.target.value } : settings)} onBlur={(e) => updateSetting({ hr_system_name: e.target.value || null })} /></div>
            <div><Label className="text-xs text-muted-foreground">Secure webhook URL</Label><Input type="url" value={settings?.hr_webhook_url ?? ""} disabled={!canManage} placeholder="https://hr.example.com/webhooks/absence" onChange={(e) => setSettings(settings ? { ...settings, hr_webhook_url: e.target.value } : settings)} onBlur={(e) => updateSetting({ hr_webhook_url: e.target.value || null })} /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Set HR_WEBHOOK_SECRET on the server if your HR endpoint requires bearer authentication.</p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Shift types</h3>
            <p className="text-xs text-muted-foreground">Day, night, half — or add your own.</p>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" onClick={addType}><Plus className="h-4 w-4" />Add type</Button>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-border p-2">
              <input type="color" value={t.color} disabled={!canManage}
                     onChange={(e) => updateType(t.id, { color: e.target.value })}
                     className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
              <Input value={t.label} disabled={!canManage}
                     onChange={(e) => setTypes((p) => p.map((x) => x.id === t.id ? { ...x, label: e.target.value } : x))}
                     onBlur={(e) => updateType(t.id, { label: e.target.value })}
                     className="flex-1" />
              <Input type="time" value={t.start_time.slice(0, 5)} disabled={!canManage}
                     onChange={(e) => updateType(t.id, { start_time: e.target.value })}
                     className="w-28" />
              <Input type="time" value={t.end_time.slice(0, 5)} disabled={!canManage}
                     onChange={(e) => updateType(t.id, { end_time: e.target.value })}
                     className="w-28" />
              <label className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                <Switch checked={t.is_active} disabled={!canManage}
                        onCheckedChange={(v) => updateType(t.id, { is_active: v })} />
                Active
              </label>
              {canManage && (
                <Button variant="ghost" size="icon" onClick={() => removeType(t.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}
