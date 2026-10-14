import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div data-full-bleed className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-sm text-muted-foreground lg:h-dvh">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading flow builder…
    </div>
  );
}
