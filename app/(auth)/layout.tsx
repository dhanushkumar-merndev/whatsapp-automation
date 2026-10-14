import { Logo } from "@/components/brand/logo";

// Authenticated, per-request pages: never prerendered or cached.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Private system · Authorised administrators only · Every sign-in requires an authenticator code
      </p>
    </div>
  );
}
