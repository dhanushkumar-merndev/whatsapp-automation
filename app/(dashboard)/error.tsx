"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <TriangleAlert className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        This page couldn&apos;t load. It may be a temporary problem — try again in a moment.
        {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/overview">Go to Overview</Link>
        </Button>
      </div>
    </div>
  );
}
