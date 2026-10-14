import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">This item doesn&apos;t exist or was deleted.</p>
      <Button variant="outline" className="mt-6" asChild>
        <Link href="/overview">Go to Overview</Link>
      </Button>
    </div>
  );
}
