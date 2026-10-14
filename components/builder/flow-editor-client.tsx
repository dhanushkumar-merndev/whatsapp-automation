"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { FlowEditorProps } from "./flow-editor";

// The canvas is browser-only (React Flow, localStorage, keyboard shortcuts).
const FlowEditor = dynamic(() => import("./flow-editor").then((m) => m.FlowEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-8rem)] items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading flow builder…
    </div>
  ),
});

export function FlowEditorClient(props: FlowEditorProps) {
  return <FlowEditor {...props} />;
}
