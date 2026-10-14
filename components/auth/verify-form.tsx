"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { verifyMfaAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { FormError } from "./form-error";
import { OtpField } from "./otp-field";
import { AUTH_BUTTON } from "./auth-panel";

export function VerifyForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyMfaAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <OtpField onComplete={() => formRef.current?.requestSubmit()} />
      <FormError message={state?.error} />
      <Button type="submit" className={AUTH_BUTTON} size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Verify
      </Button>
    </form>
  );
}
