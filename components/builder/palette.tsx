"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NODE_CATEGORY_LABELS, NODE_REGISTRY, type NodeCategory } from "@/lib/engine/registry";
import type { NodeType } from "@/lib/engine/schema";
import { NODE_ICONS } from "./node-icons";

export const DRAG_MIME = "application/x-sgh-node";

export function Palette({ onAdd, hasTrigger }: { onAdd: (type: NodeType) => void; hasTrigger: boolean }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = Object.values(NODE_REGISTRY).filter(
      (d) => !q || d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.type.includes(q),
    );
    const by = new Map<NodeCategory, typeof items>();
    for (const i of items) by.set(i.category, [...(by.get(i.category) ?? []), i]);
    return [...by.entries()];
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes" className="h-9 rounded-full bg-muted pl-8 text-sm border-transparent" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Click to add after the selected step, or drag onto the canvas.</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {groups.map(([cat, items]) => (
            <div key={cat}>
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {NODE_CATEGORY_LABELS[cat]}
              </div>
              <div className="space-y-1">
                {items.map((d) => {
                  const Icon = NODE_ICONS[d.type];
                  const disabled = d.singleton && hasTrigger;
                  return (
                    <button
                      key={d.type}
                      type="button"
                      draggable={!disabled}
                      disabled={disabled}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, d.type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onAdd(d.type)}
                      title={d.description}
                      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="size-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{d.label}</span>
                        <span className="line-clamp-2 block text-[11px] text-muted-foreground">{d.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No nodes match “{query}”.</p>}
        </div>
      </ScrollArea>
    </div>
  );
}
