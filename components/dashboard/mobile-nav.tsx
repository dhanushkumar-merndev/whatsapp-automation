"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/brand/logo";
import type { Role } from "@/lib/auth/steps";
import { SidebarNav } from "./sidebar";

export function MobileNav({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] bg-sidebar p-3">
        <SheetHeader className="p-0">
          <SheetTitle>
            <Logo />
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <SidebarNav role={role} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
