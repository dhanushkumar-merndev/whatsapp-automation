"use client";

import { memo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { handleColor, handleLabel } from "./model";
import { useEditorContext } from "./editor-context";
import { StepPicker } from "./step-picker";

/** Connection with its branch label; hovering shows a "+" that inserts a step in between. */
function InsertEdgeComponent(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sourceHandleId, markerEnd, style, selected } = props;
  const { actions } = useEditorContext();
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14 });
  const label = handleLabel(sourceHandleId);
  const color = handleColor(sourceHandleId);

  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHover(true);
  };
  const leave = () => {
    leaveTimer.current = setTimeout(() => setHover(false), 180);
  };
  const showPlus = Boolean(actions) && (hover || open || selected);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {/* Wider invisible hit area so hovering the line reveals the "+". */}
      {actions && <path d={path} fill="none" stroke="transparent" strokeWidth={28} onMouseEnter={enter} onMouseLeave={leave} />}
      {(label || actions) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            onMouseEnter={enter}
            onMouseLeave={leave}
          >
            {label && (
              <span className="rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium shadow-sm" style={{ color }}>
                {label}
              </span>
            )}
            {actions && (
              <StepPicker open={open} onOpenChange={setOpen} onPick={(t) => actions.insertOnEdge(id, t)}>
                <button
                  type="button"
                  aria-label="Insert a step here"
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-all hover:border-foreground hover:bg-foreground hover:text-background",
                    showPlus ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0",
                  )}
                >
                  <Plus className="size-3.5" />
                </button>
              </StepPicker>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const InsertEdge = memo(InsertEdgeComponent);
