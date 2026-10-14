"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { setPasswordAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "./form-error";
import { AUTH_BUTTON, AUTH_INPUT } from "./auth-panel";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Label htmlFor="password" className="sr-only">New password</Label>
      <Input id="password" name="password" type="password" placeholder="New password (min. 10 characters)" autoComplete="new-password" required minLength={10} className={AUTH_INPUT} />
      <Label htmlFor="confirm" className="sr-only">Confirm password</Label>
      <Input id="confirm" name="confirm" type="password" placeholder="Confirm password" autoComplete="new-password" required className={AUTH_INPUT} />
      <FormError message={state?.error} />
      <Button type="submit" className={AUTH_BUTTON} size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save password
      </Button>
    </form>
  );
}
