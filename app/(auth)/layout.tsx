import { Logo } from "@/components/brand/logo";

// Authenticated, per-request pages: never prerendered or cached.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="px-5 py-4">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        Private system · Authorised administrators only · Every sign-in requires an authenticator code
      </footer>
    </div>
  );
}
