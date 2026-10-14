"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `value` to the clipboard. With an empty `label` only the icon is shown. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  };
  const Icon = copied ? Check : Copy;
  return (
    <Button type="button" variant="ghost" size={label ? "xs" : "icon-xs"} onClick={copy} className={className} aria-label={label || "Copy"}>
      <Icon />
      {label && (copied ? "Copied" : label)}
    </Button>
  );
}
