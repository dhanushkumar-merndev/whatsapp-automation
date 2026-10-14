"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchInput } from "@/components/common/search-input";

const FILTER_KEYS = ["q", "service", "assigned", "from", "to", "test"];

export function LeadFilters({ services, staff }: { services: string[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.push(`/leads?${next.toString()}`, { scroll: false });
  };
  const active = FILTER_KEYS.some((k) => sp.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search name, number, business…" />
      <Select value={sp.get("service") || "__all"} onValueChange={(v) => set({ service: v === "__all" ? "" : v })}>
        <SelectTrigger size="sm" className="w-48 rounded-full">
          <SelectValue placeholder="All services" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All services</SelectItem>
          {services.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sp.get("assigned") || "__all"} onValueChange={(v) => set({ assigned: v === "__all" ? "" : v })}>
        <SelectTrigger size="sm" className="w-44 rounded-full">
          <SelectValue placeholder="Anyone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Any assignee</SelectItem>
          <SelectItem value="me">Assigned to me</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {staff.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5 rounded-full border border-input py-0.5 pr-1 pl-3.5 text-xs text-muted-foreground">
        <span>From</span>
        <Input
          type="date"
          value={sp.get("from") ?? ""}
          onChange={(e) => set({ from: e.target.value })}
          className="h-8 w-[8.5rem] border-0 px-1 text-sm shadow-none focus-visible:ring-0"
          aria-label="From date"
        />
        <span>to</span>
        <Input
          type="date"
          value={sp.get("to") ?? ""}
          onChange={(e) => set({ to: e.target.value })}
          className="h-8 w-[8.5rem] border-0 px-1 text-sm shadow-none focus-visible:ring-0"
          aria-label="To date"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
        <Switch checked={sp.get("test") === "1"} onCheckedChange={(on) => set({ test: on ? "1" : "" })} />
        Include test leads
      </label>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const view = sp.get("view");
            router.push(`/leads${view ? `?view=${view}` : ""}`, { scroll: false });
          }}
        >
          <X /> Clear filters
        </Button>
      )}
    </div>
  );
}
