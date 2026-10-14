import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function LogoutButton({
  variant = "ghost",
  className,
  label = "Sign out",
  icon = false,
}: {
  variant?: "ghost" | "link" | "outline";
  className?: string;
  label?: string;
  icon?: boolean;
}) {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant={variant} size="sm" className={className}>
        {icon && <LogOut />}
        {label}
      </Button>
    </form>
  );
}
