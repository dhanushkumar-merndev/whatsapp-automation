"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteIntegrationAction, retryDeliveryAction, testIntegrationAction } from "@/app/(dashboard)/crm/actions";

export function TestIntegrationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await testIntegrationAction({ id });
          if (!r.ok) toast.error(r.error);
          else if (r.data?.ok) toast.success(`Connected — HTTP ${r.data.statusCode} in ${r.data.durationMs} ms`);
          else toast.error(`Test failed: ${r.data?.error ?? "unknown error"}`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <PlugZap />} Test connection
    </Button>
  );
}

export function DeleteIntegrationButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${name}" and its delivery history?`)) return;
        start(async () => {
          const r = await deleteIntegrationAction({ id });
          if (!r.ok) toast.error(r.error);
          router.refresh();
        });
      }}
    >
      <Trash2 /> Delete
    </Button>
  );
}

export function RetryDeliveryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryDeliveryAction({ deliveryId: id });
          if (r.ok) toast.success(`Retry: ${r.data}`);
          else toast.error(r.error);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
    </Button>
  );
}
