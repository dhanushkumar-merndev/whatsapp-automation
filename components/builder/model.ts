import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { NODE_REGISTRY, outputsFor } from "@/lib/engine/registry";
import type { FlowDefinition, NodeType } from "@/lib/engine/schema";

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  label: string;
  config: Record<string, unknown>;
  /** Highlighted by the simulator (execution path). */
  highlight?: "visited" | "current" | null;
  issues?: number;
  /** Output handles that already have a connection (hides their "+" button). */
  connected?: string[];
}

export type EditorNode = Node<FlowNodeData, "flowNode">;
export type EditorEdge = Edge;

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 110;
export const EDGE_TYPE = "insertable";
const GAP_X = 40;
const GAP_Y = 90;

/** Branch colours are semantic (yes/valid vs no/failed); plain "Next" edges stay neutral. */
export function handleTone(handle: string | null | undefined): "neutral" | "positive" | "negative" {
  const h = handle ?? "out";
  if (h === "invalid" || h === "false") return "negative";
  if (h === "valid" || h === "true") return "positive";
  return "neutral";
}

const TONE_COLORS = { neutral: "#8f8f8f", positive: "#16a34a", negative: "#dc2626" } as const;

export function handleColor(handle: string | null | undefined): string {
  return TONE_COLORS[handleTone(handle)];
}

// Branch output ids are unique across node types (valid/invalid, true/false).
const BRANCH_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(NODE_REGISTRY).flatMap((d) => d.outputs.filter((o) => o.id !== "out").map((o) => [o.id, o.label])),
);

/** Label for a branch output, e.g. "Yes" / "Failed"; empty for the single "Next" output. */
export function handleLabel(handle: string | null | undefined): string {
  return BRANCH_LABELS[handle ?? "out"] ?? "";
}

export function edgeStyle(sourceHandle: string | null | undefined): Partial<EditorEdge> {
  const color = handleColor(sourceHandle);
  return {
    type: EDGE_TYPE,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: { stroke: color, strokeWidth: 1.6 },
  };
}

export function makeEdge(source: string, handle: string, target: string): EditorEdge {
  return { id: `e_${source}_${handle}_${target}`, source, target, sourceHandle: handle, ...edgeStyle(handle) };
}

/** Adds an edge, replacing any existing edge from the same output (one connection per output). */
export function connectEdge(edges: EditorEdge[], source: string, handle: string, target: string): EditorEdge[] {
  return [...edges.filter((e) => !(e.source === source && (e.sourceHandle ?? "out") === handle)), makeEdge(source, handle, target)];
}

export function toEditor(def: FlowDefinition): { nodes: EditorNode[]; edges: EditorEdge[] } {
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: "flowNode",
      position: n.position,
      data: { nodeType: n.type, label: n.data.label, config: n.data.config },
      deletable: true,
    })),
    edges: def.edges.map((e) => makeEdge(e.source, e.sourceHandle ?? "out", e.target)),
  };
}

export function toDefinition(nodes: EditorNode[], edges: EditorEdge[]): FlowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: { label: n.data.label ?? "", config: n.data.config },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? "out",
    })),
  };
}

export function newNodeId(type: NodeType) {
  return `n_${type}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createNode(type: NodeType, position: { x: number; y: number }): EditorNode {
  const def = NODE_REGISTRY[type];
  return {
    id: newNodeId(type),
    type: "flowNode",
    position,
    data: { nodeType: type, label: def.label, config: def.defaults() as Record<string, unknown> },
    selected: true,
  };
}

// --- Placement ------------------------------------------------------------------

type Point = { x: number; y: number };

function sizeOf(n: EditorNode) {
  return { w: n.measured?.width ?? NODE_WIDTH, h: n.measured?.height ?? NODE_HEIGHT };
}

function collides(p: Point, nodes: EditorNode[]): boolean {
  const pad = 24;
  return nodes.some((n) => {
    const { w, h } = sizeOf(n);
    return p.x < n.position.x + w + pad && p.x + NODE_WIDTH + pad > n.position.x && p.y < n.position.y + h + pad && p.y + NODE_HEIGHT + pad > n.position.y;
  });
}

/** Nearest free spot to `start`: tries sideways (right, left, …) first, then the next row down. */
export function findFreeSpot(start: Point, nodes: EditorNode[]): Point {
  for (let row = 0; row < 10; row++) {
    for (let k = 0; k < 7; k++) {
      const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (NODE_WIDTH + GAP_X);
      const p = { x: start.x + dx, y: start.y + row * (NODE_HEIGHT + GAP_Y) };
      if (!collides(p, nodes)) return p;
    }
  }
  return start;
}

/** Position for a step added after `source` on `handle`; branches fan out left/right. */
export function placeBelow(source: EditorNode, handle: string, nodes: EditorNode[]): Point {
  const outputs = outputsFor(source.data.nodeType, source.data.config);
  const idx = Math.max(0, outputs.findIndex((o) => o.id === handle));
  const { w, h } = sizeOf(source);
  const spread = outputs.length > 1 ? (idx - (outputs.length - 1) / 2) * (NODE_WIDTH + GAP_X) : 0;
  const start = { x: Math.round(source.position.x + (w - NODE_WIDTH) / 2 + spread), y: Math.round(source.position.y + h + GAP_Y) };
  return findFreeSpot(
    start,
    nodes.filter((n) => n.id !== source.id),
  );
}

/** Adds `node` after `sourceId`'s output and connects it. */
export function addAfter(
  nodes: EditorNode[],
  edges: EditorEdge[],
  sourceId: string,
  handle: string,
  type: NodeType,
): { nodes: EditorNode[]; edges: EditorEdge[]; node: EditorNode } | null {
  const source = nodes.find((n) => n.id === sourceId);
  if (!source) return null;
  const node = createNode(type, placeBelow(source, handle, nodes));
  return {
    nodes: [...nodes.map((n) => ({ ...n, selected: false })), node],
    edges: connectEdge(edges, sourceId, handle, node.id),
    node,
  };
}

/**
 * Inserts a new step on an existing edge: source → new → target. The target and
 * everything below it moves down to make room.
 */
export function insertBetween(
  nodes: EditorNode[],
  edges: EditorEdge[],
  edgeId: string,
  type: NodeType,
): { nodes: EditorNode[]; edges: EditorEdge[]; node: EditorNode } | null {
  const edge = edges.find((e) => e.id === edgeId);
  const source = edge && nodes.find((n) => n.id === edge.source);
  const target = edge && nodes.find((n) => n.id === edge.target);
  if (!edge || !source || !target) return null;
  const handle = edge.sourceHandle ?? "out";
  const node = createNode(type, { x: target.position.x + (sizeOf(target).w - NODE_WIDTH) / 2, y: target.position.y });

  // Shift the target's descendants (but never the source or anything above it, which a loop could reach).
  const shift = NODE_HEIGHT + GAP_Y;
  const moved = new Set<string>();
  const stack = [target.id];
  while (stack.length) {
    const id = stack.pop()!;
    const n = nodes.find((x) => x.id === id);
    if (!n || moved.has(id) || id === source.id || n.position.y <= source.position.y) continue;
    moved.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }

  const firstOut = NODE_REGISTRY[type].outputs[0]?.id;
  let nextEdges = connectEdge(
    edges.filter((e) => e.id !== edgeId),
    source.id,
    handle,
    node.id,
  );
  if (firstOut) nextEdges = connectEdge(nextEdges, node.id, firstOut, target.id);

  return {
    nodes: [
      ...nodes.map((n) => ({
        ...n,
        selected: false,
        position: moved.has(n.id) ? { x: n.position.x, y: n.position.y + shift } : n.position,
      })),
      node,
    ],
    edges: nextEdges,
    node,
  };
}

/** Top-to-bottom layered layout (dagre). */
export function autoLayout(nodes: EditorNode[], edges: EditorEdge[]): EditorNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.measured?.width ?? NODE_WIDTH, height: n.measured?.height ?? NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.measured?.width ?? NODE_WIDTH;
    const h = n.measured?.height ?? NODE_HEIGHT;
    return p ? { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } } : n;
  });
}
