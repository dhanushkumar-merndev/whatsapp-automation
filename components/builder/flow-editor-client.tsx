"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { FlowEditorProps } from "./flow-editor";

// The canvas is browser-only (React Flow, localStorage, keyboard shortcuts).
const FlowEditor = dynamic(() => import("./flow-editor").then((m) => m.FlowEditor), {
  ssr: false,
  loading: () => (
    <div data-full-bleed className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-sm text-muted-foreground lg:h-dvh">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading flow builder…
    </div>
  ),
});

export function FlowEditorClient(props: FlowEditorProps) {
  return <FlowEditor {...props} />;
}
