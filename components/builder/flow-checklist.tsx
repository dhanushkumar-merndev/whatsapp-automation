"use client";

import { useMemo } from "react";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import type { FlowDefinition } from "@/lib/engine/schema";
import type { GraphValidation } from "@/lib/engine/validate-graph";
import { cn } from "@/lib/utils";

const SHORTCUTS: [string, string][] = [
  ["Undo / redo", "Ctrl Z · Ctrl Shift Z"],
  ["Copy / paste steps", "Ctrl C · Ctrl V"],
  ["Duplicate step", "Ctrl D"],
  ["Delete step", "Del"],
  ["Save now", "Ctrl S"],
];

/** Shown when no step is selected: what's left before publishing, plus tips. */
export function FlowChecklist({
  definition,
  validation,
  tested,
  onSelect,
  onTest,
}: {
  definition: FlowDefinition;
  validation: GraphValidation;
  tested: boolean;
  onSelect: (nodeId: string) => void;
  onTest: () => void;
}) {
  const { trigger, unreachable } = useMemo(() => {
    const trigger = definition.nodes.find((n) => n.type === "trigger");
    const seen = new Set<string>();
    const stack = trigger ? [trigger.id] : [];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of definition.edges) if (e.source === id) stack.push(e.target);
    }
    return { trigger, unreachable: definition.nodes.filter((n) => !seen.has(n.id)) };
  }, [definition]);

  const firstError = validation.errors.find((e) => e.nodeId);
  const items = [
    { done: Boolean(trigger), label: "Flow has a start", hint: "Add “Customer message” from the steps list.", action: trigger ? () => onSelect(trigger.id) : undefined },
    {
      done: definition.nodes.length > 1 && unreachable.length === 0,
      label: "Every step is connected",
      hint: definition.nodes.length <= 1 ? "Click + under the start step to add a reply." : `${unreachable.length} step(s) can't be reached.`,
      action: unreachable[0] ? () => onSelect(unreachable[0].id) : undefined,
    },
    {
      done: validation.errors.length === 0,
      label: "No errors",
      hint: `${validation.errors.length} error(s) block publishing.`,
      action: firstError?.nodeId ? () => onSelect(firstError.nodeId!) : undefined,
    },
    { done: tested, label: "Tried it in the simulator", hint: "Chat with your flow before publishing.", action: onTest },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-6 p-4">
      <div>
        <div className="text-[15px] font-semibold">Flow checklist</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {doneCount === items.length ? "All set. Publish when you're ready." : `${doneCount} of ${items.length} done. Select a step on the canvas to edit it.`}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      </div>
      <ul className="divide-y rounded-2xl border">
        {items.map((i) => (
          <li key={i.label}>
            <button
              type="button"
              disabled={!i.action}
              onClick={i.action}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors enabled:hover:bg-muted/50"
            >
              {i.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] font-medium", i.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{i.label}</span>
                {!i.done && <span className="mt-0.5 block text-xs text-muted-foreground">{i.hint}</span>}
              </span>
              {i.action && !i.done && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">How to build</div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>• Click the + under a step to add what happens next.</li>
          <li>• Hover a line and click + to insert a step in between.</li>
          <li>• Drag from a dot to an empty spot to pick a step there.</li>
          <li>• Changes save automatically. Customers only see them after you publish.</li>
        </ul>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Shortcuts</div>
        <dl className="space-y-1 text-xs">
          {SHORTCUTS.map(([what, keys]) => (
            <div key={what} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{what}</dt>
              <dd className="font-mono text-[11px]">{keys}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
