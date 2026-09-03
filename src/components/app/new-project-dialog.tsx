import { useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
import { useOrg } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { PROJECT_COLORS, slugifyKey } from "@/lib/projects";
import { useNavigate } from "@tanstack/react-router";

export function NewProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { currentOrg } = useOrg();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"workspace" | "private">("workspace");
  const [color, setColor] = useState(PROJECT_COLORS[0]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.object({
      name: z.string().trim().min(2).max(80),
      key: z.string().trim().min(2).max(6).regex(/^[A-Z0-9]+$/),
    }).safeParse({ name, key: key || slugifyKey(name) });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setLoading(true);
    const { data: u } = await postgres.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const { data, error } = await postgres
      .from("projects")
      .insert({
        organization_id: currentOrg.organization_id,
        name: parsed.data.name,
        key: parsed.data.key,
        description: description.trim() || null,
        visibility,
        color,
        lead_id: u.user.id,
        created_by: u.user.id,
      })
      .select("id, key")
      .single();
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Project created");
    setOpen(false);
    setName(""); setKey(""); setDescription("");
    navigate({ to: "/app/projects/$key", params: { key: data.key } });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm"><Plus className="h-4 w-4" />New project</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create project</DialogTitle></DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => { setName(e.target.value); if (!key) setKey(slugifyKey(e.target.value)); }} placeholder="Mobile App" required />
          </Field>
          <Field label="Key (used for task IDs e.g. MOB-12)">
            <Input value={key} onChange={(e) => setKey(slugifyKey(e.target.value))} placeholder="MOB" maxLength={6} required />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Visibility">
              <Select value={visibility} onValueChange={(v) => setVisibility(v as never)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">Workspace</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Color">
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={`h-6 w-6 rounded-md ring-offset-2 ring-offset-background transition ${color === c ? "ring-2 ring-foreground" : ""}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
