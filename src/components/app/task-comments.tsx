import { useCallback, useEffect, useRef, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Trash2, Send, MessageSquare } from "lucide-react";

type Mention = { user_id: string; label: string; start: number; end: number };
type MentionMember = { user_id: string; name: string; email: string };

// Composer offsets use browser UTF-16 positions; persisted offsets use Unicode characters.
function renderMessage(comment: Comment) {
  const chars = Array.from(comment.body);
  const parts = [];
  let cursor = 0;
  for (const mention of comment.mentions ?? []) {
    parts.push(chars.slice(cursor, mention.start).join(""));
    parts.push(<span key={`${mention.start}:${mention.user_id}`} className="rounded bg-primary/10 px-0.5 font-semibold text-primary">{chars.slice(mention.start, mention.end).join("")}</span>);
    cursor = mention.end;
  }
  parts.push(chars.slice(cursor).join(""));
  return parts;
}

interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  mentions?: Mention[];
  author?: { full_name: string | null; email: string | null } | null;
}

interface Activity {
  id: string;
  task_id: string;
  actor_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string | null; email: string | null } | null;
}

export function TaskCommentsActivity({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionMembers, setMentionMembers] = useState<MentionMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [me, setMe] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef(false);
  const loadingRef = useRef(false);
  const reloadPending = useRef(false);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "reconnecting" | "denied">("connecting");
  const messagesRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const loadMentionMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const response = await fetch(`/api/task-mention-members?taskId=${encodeURIComponent(taskId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load people");
      if (active.current) { setMentionMembers(result.members); setMembersError(""); }
    } catch (error) { if (active.current) setMembersError(error instanceof Error ? error.message : "Unable to load people"); }
    finally { if (active.current) setMembersLoading(false); }
  }, [taskId]);

  const queryMatch = body.slice(0, cursor).match(/(?:^|\s)@([^\n@]{0,60})$/);
  const mentionStart = queryMatch ? cursor - queryMatch[1].length - 1 : -1;
  const choosingMention = !dismissed && mentionStart >= 0 && !mentions.some((mention) => mentionStart >= mention.start && mentionStart < mention.end);
  const query = queryMatch?.[1].toLowerCase() ?? "";
  const suggestions = [
    { user_id: "everyone", name: "everyone", email: "Notify everyone with access to this task" },
    ...mentionMembers,
  ].filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query));
  const selectedIndex = Math.min(suggestionIndex, Math.max(0, suggestions.length - 1));

  function changeBody(next: string, nextCursor: number) {
    let start = 0;
    while (start < body.length && start < next.length && body[start] === next[start]) start++;
    let oldEnd = body.length;
    let newEnd = next.length;
    while (oldEnd > start && newEnd > start && body[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
    const delta = next.length - body.length;
    setMentions((current) => current.flatMap((mention) => {
      if (mention.end <= start) return [mention];
      if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
      return [];
    }));
    setBody(next); setCursor(nextCursor); setSuggestionIndex(0); setDismissed(false);
  }

  function chooseMention(member: MentionMember) {
    if (mentionStart < 0) return;
    const label = `@${member.name.replace(/[\r\n]+/g, " ")}`;
    const replacement = `${label} `;
    const next = body.slice(0, mentionStart) + replacement + body.slice(cursor);
    if (next.length > 10000 || mentions.length >= 100) return toast.error("This message has reached its mention or length limit.");
    const delta = replacement.length - (cursor - mentionStart);
    setMentions((current) => [
      ...current.flatMap((mention) => mention.end <= mentionStart ? [mention] : mention.start >= cursor ? [{ ...mention, start: mention.start + delta, end: mention.end + delta }] : []),
      { user_id: member.user_id, label, start: mentionStart, end: mentionStart + label.length },
    ].sort((a, b) => a.start - b.start));
    const nextCursor = mentionStart + replacement.length;
    setBody(next); setCursor(nextCursor); setDismissed(true);
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.setSelectionRange(nextCursor, nextCursor); });
  }

  const loadAll = useCallback(async (): Promise<void> => {
    if (loadingRef.current) { reloadPending.current = true; return; }
    loadingRef.current = true;
    try {
    const [{ data: c, error: commentsError }, { data: a, error: activityError }] = await Promise.all([
      postgres.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
      postgres.from("task_activity").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (commentsError || activityError) throw new Error(commentsError?.message ?? activityError?.message);
    const userIds = Array.from(new Set([
      ...((c ?? []).map((x) => x.author_id)),
      ...((a ?? []).map((x) => x.actor_id).filter(Boolean) as string[]),
    ]));
    const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length) {
      const { data: profs } = await postgres.from("profiles").select("id, full_name, email").in("id", userIds);
      (profs ?? []).forEach((p) => profileMap.set(p.id, { full_name: p.full_name, email: p.email }));
    }
    if (!active.current) return;
    setError("");
    setComments((c ?? []).map((x) => ({ ...x, author: profileMap.get(x.author_id) ?? null })) as Comment[]);
    setActivity((a ?? []).map((x) => ({
      ...x,
      payload: (x.payload ?? {}) as Record<string, unknown>,
      actor: x.actor_id ? profileMap.get(x.actor_id) ?? null : null,
    })) as Activity[]);
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : "Unable to load task chat");
    } finally {
      loadingRef.current = false;
      if (active.current) setLoading(false);
      if (active.current && reloadPending.current) { reloadPending.current = false; void loadAll(); }
    }
  }, [taskId]);

  useEffect(() => {
    if (nearBottom.current && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [comments]);

  useEffect(() => {
    active.current = true;
    void loadMentionMembers();
    postgres.auth.getUser().then(({ data }) => { if (active.current) setMe(data.user?.id ?? null); }).catch(() => { if (active.current) setError("Please sign in again to send messages."); });
    loadAll();
    setLiveStatus("connecting");
    const source = new EventSource(`/api/task-chat/stream?taskId=${encodeURIComponent(taskId)}`);
    let fallback: ReturnType<typeof setInterval> | undefined;
    const stopFallback = () => { if (fallback) { clearInterval(fallback); fallback = undefined; } };
    const ready = () => {
      if (!active.current) return;
      stopFallback(); setLiveStatus("live");
      // Always fetch a snapshot on connection/reconnection to recover missed events.
      void loadAll(); void loadMentionMembers();
    };
    source.addEventListener("ready", ready);
    source.addEventListener("changed", () => { if (active.current) void loadAll(); });
    source.addEventListener("access-denied", () => {
      source.close(); stopFallback();
      if (active.current) {
        active.current = false; setLoading(false);
        setLiveStatus("denied"); setMe(null); setComments([]); setActivity([]);
        setError("You no longer have access to this task. Please reopen the task or sign in again.");
      }
    });
    source.onerror = () => {
      if (!active.current) return;
      setLiveStatus("reconnecting");
      // EventSource reconnects automatically. Poll only while the stream is unavailable.
      if (!fallback) fallback = setInterval(() => { void loadAll(); }, 8000);
    };
    return () => { active.current = false; source.close(); stopFallback(); };

  }, [taskId, loadAll, loadMentionMembers]);

  async function postComment() {
    const message = body;
    if (!message.trim() || !me || posting) return;
    setPosting(true);
    try {
      const { error } = await postgres.from("task_comments").insert({ task_id: taskId, author_id: me, body: message,
        mentions: JSON.stringify(mentions.map((mention) => ({ ...mention, start: Array.from(message.slice(0, mention.start)).length, end: Array.from(message.slice(0, mention.end)).length }))),
      });
      if (error) throw new Error(error.message);
      setBody(""); setMentions([]); setCursor(0); setDismissed(false);
      nearBottom.current = true;
      await loadAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send message"); }
    finally { setPosting(false); }
  }

  async function deleteComment(id: string) {
    try {
      const { error } = await postgres.from("task_comments").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await loadAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete message"); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" />Task chat</h3>
        <p className="mt-1 text-xs text-muted-foreground">Everyone with access to this task can see these messages.</p>
        <p role="status" className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${liveStatus === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />{liveStatus === "live" ? "Live" : liveStatus === "connecting" ? "Connecting to live chat…" : liveStatus === "denied" ? "Chat access unavailable" : "Reconnecting… Checking for new messages."}</p>
        {error && <div role="alert" className="mt-2 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => void loadAll()}>Retry</button></div>}
        <div ref={messagesRef} role="log" aria-label="Task chat messages" aria-live="polite" onScroll={(event) => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
          {loading && <p className="text-xs text-muted-foreground">Loading chat…</p>}
          {!loading && !error && comments.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No messages yet. Start the conversation.</p>}
          {comments.map((c) => (
            <div key={c.id} className={`rounded-lg border p-3 ${c.author_id === me ? "ml-6 border-primary/20 bg-primary/5" : "mr-6 border-border bg-muted/30"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <div className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px]">
                    {(c.author?.full_name ?? c.author?.email ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="font-medium">{c.author?.full_name ?? c.author?.email ?? "Unknown"}</span>
                  <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                {me === c.author_id && (
                  <button aria-label="Delete message" onClick={() => deleteComment(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{renderMessage(c)}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-2">
          <Textarea ref={composer} aria-label="Chat message" aria-describedby={`mention-help-${taskId}`} aria-controls={choosingMention ? `mention-list-${taskId}` : undefined} aria-activedescendant={choosingMention && suggestions.length ? `mention-option-${taskId}-${selectedIndex}` : undefined} rows={3} maxLength={10000} disabled={posting || !me} value={body}
            onChange={(event) => changeBody(event.target.value, event.target.selectionStart)}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            placeholder="Write a message… Type @ to mention someone"
            onKeyDown={(event) => {
              if (choosingMention) {
                if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault(); setSuggestionIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % Math.max(1, suggestions.length)); return;
                }
                if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && suggestions[selectedIndex] && !membersLoading && !membersError) {
                  event.preventDefault(); chooseMention(suggestions[selectedIndex]); return;
                }
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void postComment(); }
            }} />
          <p id={`mention-help-${taskId}`} className="text-xs text-muted-foreground">Type @ and select a person or @everyone to notify them.</p>
          {choosingMention && <div className="rounded-lg border bg-popover p-1 shadow-md">
            {membersLoading ? <p className="p-2 text-xs text-muted-foreground">Loading people…</p> : membersError ? <div role="alert" className="p-2 text-xs text-destructive">{membersError} <button type="button" className="underline" onClick={() => void loadMentionMembers()}>Retry</button></div> : <ul id={`mention-list-${taskId}`} role="listbox" aria-label="People to mention" className="max-h-48 overflow-y-auto">
              {suggestions.length === 0 && <li className="p-2 text-xs text-muted-foreground">No matching people with access.</li>}
              {suggestions.map((member, index) => <li id={`mention-option-${taskId}-${index}`} role="option" aria-selected={index === selectedIndex} key={member.user_id}>
                <button type="button" className={`w-full rounded-md px-3 py-2 text-left ${index === selectedIndex ? "bg-accent" : "hover:bg-accent/60"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(member)}>
                  <div className="text-sm font-medium">@{member.name}</div><div className="truncate text-xs text-muted-foreground">{member.email}</div>
                </button>
              </li>)}
            </ul>}
          </div>}

          <div className="flex justify-end">
            <Button size="sm" disabled={posting || !me || !body.trim()} onClick={postComment}>
              {posting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}Send
            </Button>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground">Activity</Label>
        {activity.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                <div className="flex-1">
                  <span className="text-foreground">{a.actor?.full_name ?? a.actor?.email ?? "Someone"}</span>{" "}
                  {formatAction(a)}
                  <span className="ml-2 text-[10px]">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatAction(a: Activity): string {
  const p = a.payload as Record<string, string | undefined>;
  switch (a.action) {
    case "commented": return "commented";
    case "status_changed": return `changed status ${p.from ?? "?"} → ${p.to ?? "?"}`;
    case "assigned": return `assigned to ${p.assignee ?? "someone"}`;
    case "priority_changed": return `set priority to ${p.to ?? "?"}`;
    case "created": return "created the task";
    default: return a.action.replace(/_/g, " ");
  }
}
