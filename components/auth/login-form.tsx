"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { loginAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "./form-error";
import { AUTH_BUTTON, AUTH_INPUT } from "./auth-panel";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next ?? ""} />
      <Label htmlFor="login" className="sr-only">Email or login ID</Label>
      <Input id="login" name="login" placeholder="Email or login ID" autoComplete="username" required autoFocus className={AUTH_INPUT} />
      <Label htmlFor="password" className="sr-only">Password</Label>
      <Input id="password" name="password" type="password" placeholder="Password" autoComplete="current-password" required className={AUTH_INPUT} />
      <FormError message={state?.error ?? initialError} />
      <Button type="submit" className={AUTH_BUTTON} size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Continue
      </Button>
    </form>
  );
}
