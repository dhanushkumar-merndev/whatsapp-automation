"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import { cn } from "@/lib/utils";
import { NODE_ICONS } from "./node-icons";
import { nodeSummary } from "./node-summary";
import type { EditorNode } from "./model";
import { useEditorContext } from "./editor-context";

function FlowNodeComponent({ data, selected }: NodeProps<EditorNode>) {
  const def = NODE_REGISTRY[data.nodeType];
  const Icon = NODE_ICONS[data.nodeType];
  const { mediaNames } = useEditorContext();
  const outputs = def.outputs;
  return (
    <div
      className={cn(
        "w-[260px] rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-shadow",
        selected && "ring-2 ring-foreground/70",
        data.highlight === "visited" && "ring-2 ring-success/40",
        data.highlight === "current" && "ring-[3px] ring-success",
      )}
    >
      {def.hasInput && <Handle type="target" position={Position.Top} className="!size-2.5 !border-2 !border-card !bg-muted-foreground/70" />}
      <div className="flex items-start gap-2.5 p-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${def.color}1a`, color: def.color }}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-[13px] font-medium">{data.label || def.label}</div>
            {data.issues ? <AlertTriangle className="size-3.5 shrink-0 text-warning" /> : null}
          </div>
          <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{def.label}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{nodeSummary(data.nodeType, data.config, mediaNames)}</div>
        </div>
      </div>
      {outputs.length === 1 && (
        <Handle id={outputs[0].id} type="source" position={Position.Bottom} className="!size-2.5 !border-2 !border-card !bg-muted-foreground" />
      )}
      {outputs.length > 1 && (
        <div className="relative flex h-5 rounded-b-2xl border-t bg-muted/50 text-[10px] text-muted-foreground">
          {outputs.map((o, i) => {
            const left = `${((i + 0.5) / outputs.length) * 100}%`;
            const color = o.id === "invalid" || o.id === "false" ? "var(--destructive)" : "var(--success)";
            return (
              <div key={o.id} className="absolute -translate-x-1/2 pt-0.5" style={{ left }}>
                <span style={{ color }}>{o.label}</span>
                <Handle
                  id={o.id}
                  type="source"
                  position={Position.Bottom}
                  style={{ left: "50%", background: color }}
                  className="!size-2.5 !border-2 !border-card"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const FlowNode = memo(FlowNodeComponent);
