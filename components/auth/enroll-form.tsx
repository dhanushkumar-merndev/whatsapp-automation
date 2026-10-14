"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { beginEnrollment, verifyEnrollmentAction, type EnrollmentData, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { FormError } from "./form-error";
import { OtpField } from "./otp-field";

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
    beginEnrollment().then((r) => (r.ok ? setEnrollment(r.data) : setLoadError(r.error)));
  }, []);

  if (loadError) return <FormError message={loadError} />;
  if (!enrollment) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Preparing your QR code…
      </div>
    );
  }

  const groupedSecret = enrollment.secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open Microsoft Authenticator, Google Authenticator or another TOTP app.</li>
        <li>Scan this QR code (or enter the setup key manually).</li>
        <li>Enter the 6-digit code shown in the app.</li>
      </ol>
      <div className="flex justify-center rounded-lg border bg-white p-3">
        {/* Supabase returns the QR code as an SVG data URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qrCode} alt="Authenticator QR code" className="size-48" />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Manual setup key</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">{groupedSecret}</code>
          <Button
            type="button"
            variant="outline"
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
      </div>
      <form ref={formRef} action={action} className="space-y-4">
        <input type="hidden" name="factorId" value={enrollment.factorId} />
        <OtpField onComplete={() => formRef.current?.requestSubmit()} />
        <FormError message={state?.error} />
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Verify and continue
        </Button>
      </form>
    </div>
  );
}
