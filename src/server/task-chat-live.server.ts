import { Client } from "pg";
import { getServerConfig } from "@/lib/config.server";
import { getAuth } from "./auth.server";
import { getPool } from "./db/client.server";

type Subscriber = { taskId: string; changed: () => void; disconnected: () => void };
const subscribers = new Set<Subscriber>();
let listener: Client | undefined;
let connecting: Promise<void> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function ensureListener() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
  if (connecting) return connecting;
  if (listener) return;
  const config = getServerConfig();
  const client = new Client({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined, connectionTimeoutMillis: 10000, keepAlive: true });
  listener = client;
  const disconnected = () => {
    if (listener !== client) return;
    listener = undefined;
    for (const subscriber of [...subscribers]) subscriber.disconnected();
    void client.end().catch(() => {});
  };
  client.on("error", disconnected);
  client.on("end", disconnected);
  client.on("notification", (event) => {
    if (event.channel !== "task_chat_changed" || !event.payload) return;
    for (const subscriber of subscribers) if (subscriber.taskId === event.payload) subscriber.changed();
  });
  connecting = (async () => {
    try { await client.connect(); await client.query("LISTEN task_chat_changed"); }
    catch (error) { disconnected(); throw error; }
    finally { connecting = undefined; }
  })();
  return connecting;
}

function removeSubscriber(subscriber: Subscriber) {
  subscribers.delete(subscriber);
  if (subscribers.size || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (subscribers.size) return;
    const client = listener;
    listener = undefined;
    if (client) void client.end().catch(() => {});
  }, 30000);
  idleTimer.unref?.();
}

export async function streamTaskChat(request: Request, taskId: string) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Please sign in first" }, { status: 401 });
  const permitted = async () => {
    const currentSession = await getAuth().api.getSession({ headers: request.headers });
    if (currentSession?.user.id !== session.user.id) return false;
    const result = await getPool().query("SELECT 1 FROM tasks WHERE id=$1 AND public.can_access_project(project_id,$2)", [taskId, session.user.id]);
    return Boolean(result.rowCount);
  };
  if (!await permitted()) return Response.json({ error: "Task not available" }, { status: 404 });
  try { await ensureListener(); }
  catch { return Response.json({ error: "Live chat temporarily unavailable" }, { status: 503 }); }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let checking = false;
      let pendingChange = false;
      let heartbeat: ReturnType<typeof setInterval>;
      let lifetime: ReturnType<typeof setTimeout>;
      const send = (event: string) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(lifetime);
        request.signal.removeEventListener("abort", close);
        removeSubscriber(subscriber);
        try { controller.close(); } catch { /* Reader already disconnected. */ }
      };
      const check = async (changed: boolean) => {
        pendingChange ||= changed;
        if (checking || closed) return;
        checking = true;
        try {
          do {
            const notify = pendingChange;
            pendingChange = false;
            if (!await permitted()) { send("access-denied"); close(); return; }
            send(notify ? "changed" : "heartbeat");
          } while (pendingChange && !closed);
        } catch { close(); }
        finally { checking = false; }
      };
      const subscriber: Subscriber = { taskId, changed: () => { void check(true); }, disconnected: close };
      cleanup = close;
      subscribers.add(subscriber);
      request.signal.addEventListener("abort", close, { once: true });
      heartbeat = setInterval(() => { void check(false); }, 20000);
      // Periodic reconnection re-authenticates and catches up after proxy timeouts.
      lifetime = setTimeout(close, 5 * 60_000);
      if (request.signal.aborted) { close(); return; }
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      send("ready");
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
