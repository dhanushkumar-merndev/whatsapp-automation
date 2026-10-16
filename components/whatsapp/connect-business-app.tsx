"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { connectBusinessAppAction, type ConnectStep } from "@/app/(dashboard)/whatsapp/actions";

/* Minimal typing for the Facebook JS SDK calls used here. */
interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type SessionInfo = { event: string; wabaId: string; phoneNumberId: string };

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Couldn't load Meta's sign-in. Check your connection or ad blocker."));
    document.body.appendChild(s);
  });
}

/**
 * Meta Embedded Signup for a number already on the WhatsApp Business app
 * (coexistence): log in with Facebook, pick the business, scan the QR code on
 * the phone. The number then works in the app and here at the same time.
 */
export function ConnectBusinessApp({ appId, configId, graphVersion }: { appId: string; configId: string; graphVersion: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<ConnectStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<SessionInfo | null>(null);
  const code = useRef<string | null>(null);
  const finishing = useRef(false);

  // Meta posts the chosen WABA / number ids to this window while the popup is open.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(data.event).startsWith("FINISH")) {
          session.current = { event: data.event, wabaId: String(data.data?.waba_id ?? ""), phoneNumberId: String(data.data?.phone_number_id ?? "") };
          void finish();
        } else if (data.event === "CANCEL") {
          setBusy(false);
          setError(data.data?.current_step ? `Stopped at “${data.data.current_step}”. You can try again.` : "Sign-up was cancelled.");
        } else if (data.event === "ERROR") {
          setBusy(false);
          setError(data.data?.error_message ?? "Meta reported an error during sign-up.");
        }
      } catch {
        // Other Facebook messages are not JSON.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs once both the code (login callback) and the ids (message event) have arrived. */
  async function finish() {
    const s = session.current;
    if (!s || !code.current || finishing.current) return;
    if (!s.wabaId || !s.phoneNumberId) {
      setBusy(false);
      setError("Meta didn't return the number's details. Make sure you picked a WhatsApp Business app number.");
      return;
    }
    finishing.current = true;
    const r = await connectBusinessAppAction({
      code: code.current,
      wabaId: s.wabaId,
      phoneNumberId: s.phoneNumberId,
      coexistence: s.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    });
    finishing.current = false;
    setBusy(false);
    if (r.ok) {
      setSteps(r.data ?? []);
      router.refresh();
    } else setError(r.error);
  }

  async function start() {
    setError(null);
    setSteps([]);
    setBusy(true);
    session.current = null;
    code.current = null;
    try {
      const FB = await loadSdk(appId, graphVersion);
      FB.login(
        (r) => {
          if (r.authResponse?.code) {
            code.current = r.authResponse.code;
            void finish();
          } else {
            setBusy(false);
            setError((e) => e ?? "Sign-in was closed before finishing.");
          }
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          // Embedded Signup v4: the version and products come from the Login for Business
          // configuration, so extras stay empty (featureType / sessionInfoVersion were v2, retired 15 Oct 2026).
          // "Connect your existing WhatsApp Business app" is offered inside Meta's flow.
          extras: { setup: {} },
        },
      );
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Link2 /> Connect WhatsApp Business app number
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect your WhatsApp Business app number</DialogTitle>
            <DialogDescription>Keep using the app on your phone; the bot answers through the API on the same number.</DialogDescription>
          </DialogHeader>
          {steps.length === 0 ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Log in with the Facebook account that manages your business.</li>
              <li>Choose “Connect your existing WhatsApp Business app”, then your business.</li>
              <li>Scan the QR code with the WhatsApp Business app on your phone (Settings → Linked devices).</li>
              <li>Allow sharing chat history so old chats appear here.</li>
            </ol>
          ) : (
            <ul className="space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  {s.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  <span>
                    {s.label}
                    {s.detail && <span className="block text-xs text-muted-foreground">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            {steps.length > 0 ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <Button onClick={start} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} {busy ? "Waiting for Meta…" : "Start"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
