import { authClient } from "@/lib/auth-client";

type Result = { data: any; error: { message: string } | null };

class Query implements PromiseLike<Result> {
  private body: any;
  constructor(table: string) { this.body = { table, operation: "select", filters: [], orders: [] }; }
  select(_columns = "*") { return this; }
  insert(values: any) { this.body.operation = "insert"; this.body.values = values; return this; }
  update(values: any) { this.body.operation = "update"; this.body.values = values; return this; }
  delete() { this.body.operation = "delete"; return this; }
  upsert(values: any, options: { onConflict?: string } = {}) { this.body.operation = "upsert"; this.body.values = values; this.body.onConflict = options.onConflict; return this; }
  eq(column: string, value: any) { this.body.filters.push({ kind: "eq", column, value }); return this; }
  neq(column: string, value: any) { this.body.filters.push({ kind: "neq", column, value }); return this; }
  is(column: string, value: any) { this.body.filters.push({ kind: "eq", column, value }); return this; }
  gt(column: string, value: any) { this.body.filters.push({ kind: "gt", column, value }); return this; }
  gte(column: string, value: any) { this.body.filters.push({ kind: "gte", column, value }); return this; }
  lt(column: string, value: any) { this.body.filters.push({ kind: "lt", column, value }); return this; }
  lte(column: string, value: any) { this.body.filters.push({ kind: "lte", column, value }); return this; }
  in(column: string, value: any[]) { this.body.filters.push({ kind: "in", column, value }); return this; }
  or(value: string) { this.body.filters.push({ kind: "or", value }); return this; }
  order(column: string, options: any = {}) { this.body.orders.push({ column, ...options }); return this; }
  limit(limit: number) { this.body.limit = limit; return this; }
  single() { this.body.single = true; return this; }
  maybeSingle() { this.body.maybeSingle = true; return this; }
  then<TResult1 = Result, TResult2 = never>(resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
    return fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.body) })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok && !result.error) result.error = { message: response.statusText };
        return result as Result;
      }).then(resolve, reject);
  }
}

class PollingChannel {
  private callbacks: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  on(_event: string, _filter: any, callback: () => void) { this.callbacks.push(callback); return this; }
  subscribe() { this.timer = setInterval(() => this.callbacks.forEach((callback) => callback()), 8000); return this; }
  close() { if (this.timer) clearInterval(this.timer); }
}

export const postgres = {
  from: (table: string) => new Query(table),
  rpc: async (fn: string, params: Record<string, unknown> = {}): Promise<Result> => {
    const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "rpc", fn, params }) });
    return response.json();
  },
  channel: (_name: string) => new PollingChannel(),
  removeChannel: (channel: PollingChannel) => channel.close(),
  auth: {
    getUser: async () => { const result = await authClient.getSession(); return { data: { user: result.data?.user ?? null }, error: result.error }; },
    getSession: async () => { const result = await authClient.getSession(); return { data: { session: result.data ?? null }, error: result.error }; },
    signOut: () => authClient.signOut(),
    updateUser: async ({ data }: { data: { full_name?: string } }) => {
      const result = await authClient.updateUser({ name: data.full_name });
      return { data: { user: result.data ?? null }, error: result.error };
    },
  },
};
