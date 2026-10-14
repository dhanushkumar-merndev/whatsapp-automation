"use client";

import { CheckCircle2, CircleX, TriangleAlert } from "lucide-react";
import type { GraphValidation } from "@/lib/engine/validate-graph";

export function ValidationList({ validation, onSelect }: { validation: GraphValidation; onSelect: (nodeId: string) => void }) {
  const all = [...validation.errors, ...validation.warnings];
  if (all.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-success">
        <CheckCircle2 className="size-4" /> No problems found. This flow can be published.
      </div>
    );
  }
  return (
    <div className="space-y-1.5 p-3">
      <p className="px-1 text-[11px] text-muted-foreground">
        {validation.errors.length} error(s) block publishing · {validation.warnings.length} warning(s)
      </p>
      {all.map((i, idx) => (
        <button
          key={idx}
          type="button"
          disabled={!i.nodeId}
          onClick={() => i.nodeId && onSelect(i.nodeId)}
          className="flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs hover:bg-muted/50 disabled:cursor-default"
        >
          {i.level === "error" ? (
            <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          )}
          <span>{i.message}</span>
        </button>
      ))}
    </div>
  );
}
