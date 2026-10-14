"use client";

import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import type { FlowDefinition } from "@/lib/engine/schema";
import { FlowNode } from "./flow-node";
import { EDGE_TYPE, toEditor, type EditorEdge, type EditorNode } from "./model";
import { InsertEdge } from "./insert-edge";
import { EditorContext } from "./editor-context";

const nodeTypes = { flowNode: FlowNode };
const edgeTypes = { [EDGE_TYPE]: InsertEdge };

/** Read-only diagram highlighting the path a customer took through a flow version. */
export function ReadonlyFlow({ definition, visited, current, height = 520 }: { definition: FlowDefinition; visited: string[]; current: string | null; height?: number }) {
  const { resolvedTheme } = useTheme();
  const { nodes, edges } = useMemo(() => {
    const e = toEditor(definition);
    const seen = new Set(visited);
    const pairs = new Set(visited.slice(1).map((id, i) => `${visited[i]}>${id}`));
    return {
      nodes: e.nodes.map(
        (n) =>
          ({
            ...n,
            draggable: false,
            selectable: false,
            data: { ...n.data, highlight: n.id === current ? "current" : seen.has(n.id) ? "visited" : null },
            style: seen.has(n.id) || n.id === current ? undefined : { opacity: 0.45 },
          }) as EditorNode,
      ),
      edges: e.edges.map(
        (ed) =>
          ({
            ...ed,
            animated: pairs.has(`${ed.source}>${ed.target}`),
            style: { ...(ed.style ?? {}), opacity: pairs.has(`${ed.source}>${ed.target}`) ? 1 : 0.35 },
          }) as EditorEdge,
      ),
    };
  }, [definition, visited, current]);

  return (
    <EditorContext.Provider value={{ mediaNames: {}, media: [], crm: [], actions: null }}>
      <ReactFlowProvider>
        <div style={{ height }} className="overflow-hidden rounded-2xl border bg-muted/30">
          <ReactFlow<EditorNode, EditorEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </EditorContext.Provider>
  );
}
