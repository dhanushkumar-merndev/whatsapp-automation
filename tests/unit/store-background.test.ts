import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "@/lib/server/supabase-store";
import type { NodeLogEntry } from "@/lib/engine/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records when each write starts and ends; node "slow" takes longer than the rest. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const log: string[] = [];
  const write = async (label: string, ms: number) => {
    log.push(`start ${label}`);
    await sleep(ms);
    log.push(`end ${label}`);
    return { data: null, error: opts.fail ? { message: "boom" } : null };
  };
  const db = {
    from: (table: string) => ({
      insert: (row: { node_id?: string; title?: string }) => write(`${table}:${row.node_id ?? row.title}`, row.node_id === "slow" ? 30 : 1),
    }),
    rpc: (fn: string) => write(fn, 5),
  };
  return { db: db as unknown as SupabaseClient, log };
}

const node = (nodeId: string): NodeLogEntry => ({ executionId: "e1", nodeId, nodeType: "send_message", step: 1, status: "success" });
const ends = (log: string[]) => log.filter((l) => l.startsWith("end"));

afterEach(() => vi.restoreAllMocks());

describe("SupabaseStore background writes", () => {
  it("returns before node logs, usage and notifications are written, and flush() waits for them", async () => {
    const { db, log } = fakeDb();
    const store = new SupabaseStore(db, { backgroundWrites: true });
    await store.logNode(node("a"));
    await store.incrementUsage({ service: "whatsapp", metric: "messages_sent" });
    await store.notify({ kind: "handoff", severity: "warning", title: "t" });
    expect(ends(log)).toHaveLength(0);
    await store.flush();
    expect(ends(log)).toHaveLength(3);
  });

  it("keeps node log inserts in order even when an earlier one is slower", async () => {
    const { db, log } = fakeDb();
    const store = new SupabaseStore(db, { backgroundWrites: true });
    await store.logNode(node("slow"));
    await store.logNode(node("fast"));
    await store.flush();
    expect(log.filter((l) => l.includes("node_executions"))).toEqual([
      "start node_executions:slow",
      "end node_executions:slow",
      "start node_executions:fast",
      "end node_executions:fast",
    ]);
  });

  it("logs a failed background write instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb({ fail: true });
    const store = new SupabaseStore(db, { backgroundWrites: true });
    await store.logNode(node("a"));
    await expect(store.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[store] log node failed", "log node: boom");
  });

  it("writes inline by default", async () => {
    const { db, log } = fakeDb();
    const store = new SupabaseStore(db);
    await store.logNode(node("a"));
    expect(ends(log)).toEqual(["end node_executions:a"]);
    const failing = new SupabaseStore(fakeDb({ fail: true }).db);
    await expect(failing.logNode(node("a"))).rejects.toThrow("log node: boom");
  });
});
