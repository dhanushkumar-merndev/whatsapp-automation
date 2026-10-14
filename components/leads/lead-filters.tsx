"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function LeadFilters({ services, staff }: { services: string[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.push(`/leads?${next.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q });
        }}
      >
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, business…" className="h-9 w-64 rounded-full pl-9" />
      </form>
      <Select value={sp.get("service") || "__all"} onValueChange={(v) => set({ service: v === "__all" ? "" : v })}>
        <SelectTrigger size="sm" className="w-48">
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
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Anyone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Any assignee</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {staff.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="date" defaultValue={sp.get("from") ?? ""} onChange={(e) => set({ from: e.target.value })} className="h-9 w-40" aria-label="From date" />
      <Input type="date" defaultValue={sp.get("to") ?? ""} onChange={(e) => set({ to: e.target.value })} className="h-9 w-40" aria-label="To date" />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={sp.get("test") === "1"} onChange={(e) => set({ test: e.target.checked ? "1" : "" })} /> Include test leads
      </label>
      {(sp.get("q") || sp.get("service") || sp.get("from") || sp.get("to") || sp.get("assigned")) && (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/leads${sp.get("view") ? `?view=${sp.get("view")}` : ""}`)}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
