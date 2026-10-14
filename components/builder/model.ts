import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import type { FlowDefinition, NodeType } from "@/lib/engine/schema";

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  label: string;
  config: Record<string, unknown>;
  /** Highlighted by the simulator (execution path). */
  highlight?: "visited" | "current" | null;
  issues?: number;
}

export type EditorNode = Node<FlowNodeData, "flowNode">;
export type EditorEdge = Edge;

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 92;

const HANDLE_LABELS: Record<string, string> = { valid: "Valid", invalid: "Retries exhausted", true: "True", false: "False" };

export function edgeStyle(sourceHandle: string | null | undefined): Partial<EditorEdge> {
  const handle = sourceHandle ?? "out";
  const color =
    handle === "invalid" || handle === "false" ? "#dc2626" : handle === "valid" || handle === "true" ? "#16a34a" : "#64748b";
  return {
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
    style: { stroke: color, strokeWidth: 1.6 },
    label: HANDLE_LABELS[handle],
    labelStyle: { fontSize: 11, fill: color, fontWeight: 500 },
    labelBgStyle: { fill: "#ffffff" },
    labelBgPadding: [4, 2],
  };
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
    edges: def.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? "out",
      ...edgeStyle(e.sourceHandle),
    })),
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

/** Top-to-bottom layered layout (dagre). */
export function autoLayout(nodes: EditorNode[], edges: EditorEdge[]): EditorNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 70, marginx: 20, marginy: 20 });
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
