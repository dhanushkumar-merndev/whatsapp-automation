"use client";

import { CheckCircle2, ChevronRight, CircleX, TriangleAlert } from "lucide-react";
import type { GraphValidation } from "@/lib/engine/validate-graph";

export function ValidationList({ validation, onSelect }: { validation: GraphValidation; onSelect: (nodeId: string) => void }) {
  const all = [...validation.errors, ...validation.warnings];
  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <CheckCircle2 className="size-8 text-success" strokeWidth={1.5} />
        <div className="text-sm font-medium">No problems found</div>
        <p className="text-xs text-muted-foreground">This flow is ready to publish.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 p-4">
      <p className="text-xs text-muted-foreground">
        {validation.errors.length ? `${validation.errors.length} error(s) must be fixed before publishing.` : "No errors. "}
        {validation.warnings.length ? ` ${validation.warnings.length} warning(s) to review.` : ""}
      </p>
      {all.map((i, idx) => (
        <button
          key={idx}
          type="button"
          disabled={!i.nodeId}
          onClick={() => i.nodeId && onSelect(i.nodeId)}
          className="flex w-full items-start gap-2.5 rounded-2xl border p-3 text-left text-xs leading-relaxed transition-colors enabled:hover:bg-muted/50"
        >
          {i.level === "error" ? (
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <span className="flex-1">{i.message}</span>
          {i.nodeId && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        </button>
      ))}
    </div>
  );
}
