"use client";

import dynamic from "next/dynamic";

export const ReadonlyFlowClient = dynamic(() => import("./readonly-flow").then((m) => m.ReadonlyFlow), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse rounded-2xl bg-muted" />,
});
