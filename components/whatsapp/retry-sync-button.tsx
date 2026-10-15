"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryAppSyncAction } from "@/app/(dashboard)/whatsapp/actions";

export function RetrySyncButton({ id, kind, label }: { id: string; kind: "smb_app_state_sync" | "history"; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryAppSyncAction({ id, kind });
          if (r.ok) {
            toast.success("Requested — it can take a few minutes to arrive.");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <RotateCcw /> {label}
    </Button>
  );
}
