import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* The mark is light-on-transparent, so light mode sits it on a dark tile. */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] dark:bg-transparent">
        <Image src="/logo-dark.png" alt="" width={192} height={192} className="size-7 dark:size-8" loading="eager" />
      </div>
      {!compact && <div className="text-[15px] font-semibold tracking-tight">Star Growth Hub</div>}
    </div>
  );
}
