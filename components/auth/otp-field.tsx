"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export function OtpField({ name = "code", onComplete }: { name?: string; onComplete?: () => void }) {
  return (
    <InputOTP
      name={name}
      maxLength={6}
      inputMode="numeric"
      pattern="^[0-9]*$"
      autoComplete="one-time-code"
      autoFocus
      containerClassName="justify-center"
      onComplete={onComplete}
    >
      <InputOTPGroup className="gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <InputOTPSlot key={i} index={i} className="size-12 rounded-xl border text-lg first:rounded-xl last:rounded-xl" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
