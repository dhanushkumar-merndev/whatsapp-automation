"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheckBig, MoreHorizontal, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { updateBookingAction } from "@/app/(dashboard)/bookings/actions";

type Status = "booked" | "confirmed" | "cancelled" | "completed" | "no_show";

/** Confirm, complete, mark no-show or cancel a booking (optionally telling the customer on WhatsApp). */
export function BookingActions({ id, status, when }: { id: string; status: Status; when: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<"confirmed" | "cancelled" | null>(null);
  const [notify, setNotify] = useState(true);
  const set = (next: Status, tell = false) =>
    start(async () => {
      const r = await updateBookingAction({ bookingId: id, status: next, notify: tell });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Booking ${next.replace("_", "-")}${r.data?.notified ? " · customer told on WhatsApp" : ""}`);
      setAsk(null);
      router.refresh();
    });
  const active = status === "booked" || status === "confirmed";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Booking actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === "booked" && (
            <DropdownMenuItem onSelect={() => setAsk("confirmed")}>
              <Check /> Confirm
            </DropdownMenuItem>
          )}
          {active && (
            <>
              <DropdownMenuItem onSelect={() => set("completed")}>
                <CircleCheckBig /> Mark done
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => set("no_show")}>
                <UserX /> Didn&rsquo;t show up
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setAsk("cancelled")}>
                <X /> Cancel booking
              </DropdownMenuItem>
            </>
          )}
          {!active && (
            <DropdownMenuItem onSelect={() => set("booked")}>
              <Check /> Re-open
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ask === "cancelled" ? "Cancel this booking?" : "Confirm this booking?"}</DialogTitle>
            <DialogDescription>{when}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" />
            <span>
              Tell the customer on WhatsApp
              <span className="block text-xs text-muted-foreground">Only possible within 24 hours of their last message.</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(null)}>
              Back
            </Button>
            <Button variant={ask === "cancelled" ? "destructive" : "default"} disabled={pending} onClick={() => ask && set(ask, notify)}>
              {ask === "cancelled" ? "Cancel booking" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
