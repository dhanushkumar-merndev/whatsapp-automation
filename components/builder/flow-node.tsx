"use client";

import { memo, useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NODE_REGISTRY, outputsFor } from "@/lib/engine/registry";
import { cn } from "@/lib/utils";
import { NODE_ICONS } from "./node-icons";
import { nodeSummary } from "./node-summary";
import { handleColor, type EditorNode } from "./model";
import { useEditorContext } from "./editor-context";
import { StepPicker } from "./step-picker";

const HANDLE = "!size-3.5 !border-[2.5px] !border-card";

/** Output handle plus, while it is free, a "+" that adds the next step. */
function Output({ nodeId, handle, free, hint }: { nodeId: string; handle: string; free: boolean; hint?: boolean }) {
  const { actions } = useEditorContext();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Handle id={handle} type="source" position={Position.Bottom} className={HANDLE} style={{ background: handleColor(handle) }} />
      {actions && free && (
        // Clicking "+" must not also select the node (that would open the settings panel/sheet).
        <div className="nodrag nopan absolute top-full left-1/2 z-10 flex -translate-x-1/2 flex-col items-center" onClick={(e) => e.stopPropagation()}>
          <span className="h-4 w-px bg-border" />
          <div className="relative">
            <StepPicker open={open} onOpenChange={setOpen} onPick={(t) => actions.addAfter(nodeId, handle, t)}>
              <button
                type="button"
                aria-label="Add next step"
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:border-foreground hover:bg-foreground hover:text-background",
                  (open || hint) && "border-foreground bg-foreground text-background",
                  hint && !open && "animate-pulse",
                )}
              >
                <Plus className="size-4" />
              </button>
            </StepPicker>
            {hint && (
              <span className="pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-background">
                Add your first reply
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FlowNodeComponent({ id, data, selected }: NodeProps<EditorNode>) {
  const def = NODE_REGISTRY[data.nodeType];
  const Icon = NODE_ICONS[data.nodeType];
  const ctx = useEditorContext();
  const { actions } = ctx;
  const outputs = outputsFor(data.nodeType, data.config);
  const connected = new Set(data.connected ?? []);
  const summary = nodeSummary(data.nodeType, data.config, ctx);
  const options = data.nodeType === "interactive" ? ((data.config.options as { id: string; title: string }[]) ?? []) : [];
  // On a fresh flow, point at the trigger's "+" so the first step is obvious.
  const hint = data.nodeType === "trigger" && connected.size === 0;

  return (
    <div
      className={cn(
        "group/node relative w-[280px] rounded-2xl border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-[border-color,box-shadow]",
        selected ? "border-foreground/70 shadow-[0_0_0_3px_color-mix(in_oklch,var(--foreground),transparent_88%)]" : "hover:border-foreground/30",
        data.highlight === "visited" && "ring-2 ring-success/40",
        data.highlight === "current" && "ring-[3px] ring-success",
      )}
    >
      {actions && (
        <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
          <div className="flex items-center gap-0.5 rounded-full border bg-popover p-1 shadow-md">
            {!def.singleton && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => actions.duplicateNode(id)} aria-label="Duplicate step">
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Duplicate (Ctrl/⌘ D)</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" onClick={() => actions.deleteNode(id)} aria-label="Delete step" className="text-destructive hover:text-destructive">
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete (Del)</TooltipContent>
            </Tooltip>
          </div>
        </NodeToolbar>
      )}
      {def.hasInput && <Handle type="target" position={Position.Top} className={cn(HANDLE, "!bg-muted-foreground")} />}

      <div className="flex items-start gap-3 p-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-medium">{data.label || def.label}</div>
            {data.nodeType === "trigger" && (
              <span className="shrink-0 rounded-full bg-foreground px-1.5 py-px text-[10px] font-medium text-background">Start</span>
            )}
            <div className="flex-1" />
            {data.issues ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning"
                title={`${data.issues} issue${data.issues === 1 ? "" : "s"}`}
              >
                <AlertTriangle className="size-3" />
                {data.issues}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-muted-foreground">{def.label}</div>
          {summary && <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground/80">{summary}</div>}
          {options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {options.slice(0, 3).map((o, i) => (
                <span key={`${o.id}-${i}`} className="max-w-full truncate rounded-full border px-2 py-0.5 text-[11px]">
                  {o.title || "Untitled"}
                </span>
              ))}
              {options.length > 3 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{options.length - 3}</span>}
            </div>
          )}
        </div>
      </div>

      {outputs.length === 1 && <Output nodeId={id} handle={outputs[0].id} free={!connected.has(outputs[0].id)} hint={hint} />}
      {outputs.length > 1 && (
        <div className="flex rounded-b-2xl border-t">
          {outputs.map((o, i) => (
            <div
              key={o.id}
              className={cn("relative flex flex-1 items-center justify-center py-1.5 text-[11px] font-medium", i > 0 && "border-l")}
              style={{ color: handleColor(o.id) }}
            >
              {o.label}
              <Output nodeId={id} handle={o.id} free={!connected.has(o.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const FlowNode = memo(FlowNodeComponent);
