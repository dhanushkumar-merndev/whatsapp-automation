"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Search box that updates the `q` URL parameter as you type (debounced) and resets paging. */
export function SearchInput({ placeholder, className, param = "q" }: { placeholder: string; className?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlValue = sp.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the URL when it changes elsewhere (e.g. "Clear filters").
  const [lastUrl, setLastUrl] = useState(urlValue);
  if (urlValue !== lastUrl) {
    setLastUrl(urlValue);
    setValue(urlValue);
  }

  const push = (v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v.trim()) next.set(param, v.trim());
    else next.delete(param);
    next.delete("page");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onChange = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(v), 300);
  };

  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (timer.current) clearTimeout(timer.current);
            push(value);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-full border border-input bg-transparent pr-9 pl-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            push("");
          }}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
