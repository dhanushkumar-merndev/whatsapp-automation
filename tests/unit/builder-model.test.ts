import { describe, expect, it } from "vitest";
import { addAfter, connectEdge, createNode, findFreeSpot, insertBetween, makeEdge, NODE_HEIGHT, NODE_WIDTH, placeBelow, type EditorNode } from "@/components/builder/model";
import type { NodeType } from "@/lib/engine/schema";

function node(id: string, type: NodeType, x: number, y: number): EditorNode {
  return { ...createNode(type, { x, y }), id, selected: false };
}

function overlaps(a: EditorNode, b: EditorNode) {
  return a.position.x < b.position.x + NODE_WIDTH && a.position.x + NODE_WIDTH > b.position.x && a.position.y < b.position.y + NODE_HEIGHT && a.position.y + NODE_HEIGHT > b.position.y;
}

describe("builder placement", () => {
  it("places a new step below its source", () => {
    const trigger = node("t", "trigger", 0, 0);
    const p = placeBelow(trigger, "out", [trigger]);
    expect(p.x).toBe(0);
    expect(p.y).toBeGreaterThan(NODE_HEIGHT);
  });

  it("fans condition branches out left and right", () => {
    const cond = node("c", "condition", 0, 0);
    const yes = placeBelow(cond, "true", [cond]);
    const no = placeBelow(cond, "false", [cond]);
    expect(yes.x).toBeLessThan(no.x);
    expect(yes.y).toBe(no.y);
  });

  it("never drops a step on top of an existing one", () => {
    const trigger = node("t", "trigger", 0, 0);
    const below = placeBelow(trigger, "out", [trigger]);
    const blocker = node("b", "send_message", below.x, below.y);
    const p = placeBelow(trigger, "out", [trigger, blocker]);
    const placed = node("n", "send_message", p.x, p.y);
    expect(overlaps(placed, blocker)).toBe(false);
  });

  it("findFreeSpot returns the start point when it is free", () => {
    expect(findFreeSpot({ x: 500, y: 500 }, [node("a", "end", 0, 0)])).toEqual({ x: 500, y: 500 });
  });
});

describe("builder graph edits", () => {
  it("addAfter connects the new step and keeps one edge per output", () => {
    const t = node("t", "trigger", 0, 0);
    const m = node("m", "send_message", 0, 200);
    const r = addAfter([t, m], [makeEdge("t", "out", "m")], "t", "out", "wait");
    expect(r).not.toBeNull();
    const fromTrigger = r!.edges.filter((e) => e.source === "t");
    expect(fromTrigger).toHaveLength(1);
    expect(fromTrigger[0].target).toBe(r!.node.id);
    expect(r!.node.selected).toBe(true);
  });

  it("insertBetween rewires source → new → target and moves the target down", () => {
    const t = node("t", "trigger", 0, 0);
    const m = node("m", "send_message", 0, 200);
    const e = node("e", "end", 0, 400);
    const edges = [makeEdge("t", "out", "m"), makeEdge("m", "out", "e")];
    const r = insertBetween([t, m, e], edges, edges[0].id, "wait")!;
    const id = r.node.id;
    expect(r.edges.map((x) => `${x.source}>${x.target}`).sort()).toEqual([`${id}>m`, `m>e`, `t>${id}`].sort());
    const moved = r.nodes.find((n) => n.id === "m")!;
    const movedEnd = r.nodes.find((n) => n.id === "e")!;
    expect(moved.position.y).toBeGreaterThan(200);
    expect(movedEnd.position.y).toBeGreaterThan(400);
    expect(r.nodes.find((n) => n.id === "t")!.position.y).toBe(0);
  });

  it("insertBetween keeps the branch handle and connects a branching step by its first output", () => {
    const c = node("c", "condition", 0, 0);
    const m = node("m", "send_message", 0, 200);
    const edges = [makeEdge("c", "false", "m")];
    const r = insertBetween([c, m], edges, edges[0].id, "validation")!;
    expect(r.edges.find((x) => x.source === "c")).toMatchObject({ sourceHandle: "false", target: r.node.id });
    expect(r.edges.find((x) => x.source === r.node.id)).toMatchObject({ sourceHandle: "valid", target: "m" });
  });

  it("insertBetween with an ending step leaves the old target unconnected", () => {
    const t = node("t", "trigger", 0, 0);
    const m = node("m", "send_message", 0, 200);
    const edges = [makeEdge("t", "out", "m")];
    const r = insertBetween([t, m], edges, edges[0].id, "end")!;
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]).toMatchObject({ source: "t", target: r.node.id });
  });

  it("connectEdge replaces an existing edge from the same output", () => {
    const edges = connectEdge([makeEdge("a", "out", "b")], "a", "out", "c");
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("c");
  });
});
