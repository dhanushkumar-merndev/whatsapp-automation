"use client";

import { useMemo } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NODE_CATEGORY_LABELS, NODE_REGISTRY, type NodeCategory, type NodeDefinition } from "@/lib/engine/registry";
import type { NodeType } from "@/lib/engine/schema";
import { NODE_ICONS } from "./node-icons";

function useStepGroups(includeTrigger: boolean) {
  return useMemo(() => {
    const by = new Map<NodeCategory, NodeDefinition[]>();
    for (const d of Object.values(NODE_REGISTRY) as NodeDefinition[]) {
      if (!includeTrigger && d.type === "trigger") continue;
      by.set(d.category, [...(by.get(d.category) ?? []), d]);
    }
    return [...by.entries()];
  }, [includeTrigger]);
}

/** Searchable list of steps, grouped by category. */
export function StepList({ onPick, includeTrigger = false }: { onPick: (type: NodeType) => void; includeTrigger?: boolean }) {
  const groups = useStepGroups(includeTrigger);
  return (
    <Command className="rounded-2xl! p-1.5">
      <CommandInput placeholder="Search steps…" autoFocus />
      <CommandList className="max-h-[min(420px,60vh)]">
        <CommandEmpty>No steps match.</CommandEmpty>
        {groups.map(([cat, items]) => (
          <CommandGroup key={cat} heading={NODE_CATEGORY_LABELS[cat]}>
            {items.map((d) => {
              const Icon = NODE_ICONS[d.type];
              return (
                <CommandItem key={d.type} value={`${d.label} ${d.description}`} onSelect={() => onPick(d.type)} className="gap-2.5 rounded-xl! py-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{d.label}</span>
                    <span className="line-clamp-1 block text-[11px] text-muted-foreground">{d.description}</span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * Popover step picker. `children` is the button that opens it, or (with `anchor`)
 * an invisible element marking where it should appear.
 */
export function StepPicker({
  open,
  onOpenChange,
  onPick,
  children,
  anchor = false,
  side = "bottom",
  align = "center",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: NodeType) => void;
  children: React.ReactNode;
  anchor?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchor ? <PopoverAnchor asChild>{children}</PopoverAnchor> : <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent side={side} align={align} className="w-80 p-0" onClick={(e) => e.stopPropagation()}>
        <StepList
          onPick={(t) => {
            onOpenChange(false);
            onPick(t);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
