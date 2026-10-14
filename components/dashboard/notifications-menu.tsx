"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markNotificationsRead } from "@/app/(dashboard)/_actions/notifications";
import { cn } from "@/lib/utils";
import { fmtAgo } from "@/lib/format";

export interface NotificationItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

const DOT = { info: "bg-blue-500", warning: "bg-amber-500", critical: "bg-red-500" };

export function NotificationsMenu({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const [pending, start] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${unread} unread)`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">Notifications</div>
          <Button
            variant="ghost"
            size="xs"
            disabled={pending || unread === 0}
            onClick={() => start(async () => void (await markNotificationsRead()))}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[n.severity])} />
                    <div className="min-w-0 flex-1">
                      {n.link ? (
                        <Link href={n.link} className="text-sm font-medium hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        <div className="text-sm font-medium">{n.title}</div>
                      )}
                      {n.body && <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{n.body}</p>}
                      <div className="mt-1 text-[11px] text-muted-foreground">{fmtAgo(n.created_at)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
