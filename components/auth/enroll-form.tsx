"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { beginEnrollment, verifyEnrollmentAction, type EnrollmentData, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FormError } from "./form-error";
import { OtpField } from "./otp-field";
import { AUTH_BUTTON } from "./auth-panel";

type BeginResult = Awaited<ReturnType<typeof beginEnrollment>>;

/**
 * A dev-server recompile or a network blip can reject the action call itself;
 * retry once, then report the problem instead of spinning forever.
 */
async function startEnrollment(): Promise<BeginResult> {
  try {
    return await beginEnrollment();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      return await beginEnrollment();
    } catch {
      return { ok: false, error: "Could not reach the server to create your QR code." };
    }
  }
}

export function EnrollForm() {
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(verifyEnrollmentAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startEnrollment().then((r) => (r.ok ? setEnrollment(r.data) : setLoadError(r.error)));
  }, []);

  if (loadError) {
    return (
      <div className="space-y-4">
        <FormError message={loadError} />
        {/* A full reload loads fresh code and lets the server send you to the right step. */}
        <Button type="button" variant="outline" className={AUTH_BUTTON} size="lg" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!enrollment) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Preparing your QR code…
      </div>
    );
  }

  const groupedSecret = enrollment.secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {/* Kept on white so phone cameras can read it in dark mode. */}
        <div className="mx-auto w-fit rounded-2xl bg-white p-3">
          {/* Supabase returns the QR code as an SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="Authenticator QR code" className="size-44" />
        </div>
        <Collapsible>
          <CollapsibleTrigger className="mx-auto block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Can&apos;t scan? Enter a setup key instead
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="flex items-center gap-2 rounded-full border py-1.5 pr-1.5 pl-5">
              <code className="flex-1 font-mono text-[13px] tracking-wide break-all">{groupedSecret}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Copy setup key"
                onClick={async () => {
                  await navigator.clipboard.writeText(enrollment.secret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <form ref={formRef} action={action} className="space-y-4">
        <input type="hidden" name="factorId" value={enrollment.factorId} />
        <p className="text-center text-sm text-muted-foreground">Enter the 6-digit code from the app</p>
        <OtpField onComplete={() => formRef.current?.requestSubmit()} />
        <FormError message={state?.error} />
        <Button type="submit" className={AUTH_BUTTON} size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Verify and continue
        </Button>
      </form>
    </div>
  );
}
