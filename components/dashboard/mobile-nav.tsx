"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/brand/logo";
import type { Role } from "@/lib/auth/steps";
import { SidebarFooter, SidebarNav } from "./sidebar";

export function MobileNav({ role, name }: { role: Role; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] gap-0 bg-sidebar p-0">
        <SheetHeader className="px-5 pt-4 pb-4">
          <SheetTitle>
            <Logo />
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          <SidebarNav role={role} onNavigate={() => setOpen(false)} />
        </div>
        <SidebarFooter name={name} role={role} />
      </SheetContent>
    </Sheet>
  );
}
