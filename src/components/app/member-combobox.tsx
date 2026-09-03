import { useState } from "react";
import { Check, ChevronsUpDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface AssignableMember { user_id: string; full_name: string | null; email: string | null }

export function MemberCombobox({ members, value, onChange, placeholder = "Search for a member…" }: { members: AssignableMember[]; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const selected = members.find((member) => member.user_id === value);
  const selectedLabel = selected?.full_name ?? selected?.email ?? (value === "none" ? "Unassigned" : "Select assignee");
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal"><span className="flex min-w-0 items-center gap-2"><UserRound className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{selectedLabel}</span></span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start"><Command><CommandInput placeholder={placeholder} /><CommandList><CommandEmpty>No project member found.</CommandEmpty><CommandGroup><CommandItem value="Unassigned" onSelect={() => { onChange("none"); setOpen(false); }}><Check className={cn("h-4 w-4", value === "none" ? "opacity-100" : "opacity-0")} />Unassigned</CommandItem>{members.map((member) => { const label = member.full_name ?? member.email ?? "Unknown member"; return <CommandItem key={member.user_id} value={`${label} ${member.email ?? ""}`} onSelect={() => { onChange(member.user_id); setOpen(false); }}><Check className={cn("h-4 w-4", value === member.user_id ? "opacity-100" : "opacity-0")} /><div className="min-w-0"><div className="truncate">{label}</div>{member.full_name && member.email && <div className="truncate text-xs text-muted-foreground">{member.email}</div>}</div></CommandItem>; })}</CommandGroup></CommandList></Command></PopoverContent>
  </Popover>;
}
