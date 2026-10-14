"use client";

import { useContext } from "react";
import { List } from "lucide-react";
import { renderTemplate, type TemplateScope } from "@/lib/engine/template";
import { numberedOptionsText, resolveInteractiveMode } from "@/lib/engine/interactive";
import type { InteractiveConfig, InteractiveOption } from "@/lib/engine/schema";
import { VariablesContext } from "./fields";

/** Sample values so the preview reads like a real message. */
function useSampleScope(): TemplateScope {
  const variables = useContext(VariablesContext);
  const vars: Record<string, unknown> = { first_message: "Hi", last_message: "Hi" };
  for (const v of variables) {
    if (!v.name) continue;
    const first = v.options?.[0];
    vars[v.name] = first ? { title: first.title, id: first.id } : `‹${v.name.replace(/_/g, " ")}›`;
  }
  return {
    contact: { name: "Priya", profile_name: "Priya", business_name: "Acme Studio", phone: "+91 98000 00000", email: "priya@example.com" },
    vars,
    flow: { name: "This flow" },
  };
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">Preview</div>
      <div className="rounded-2xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">{children}</div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
      {children}
    </div>
  );
}

export function TextPreview({ text }: { text: string }) {
  const scope = useSampleScope();
  const rendered = renderTemplate(text ?? "", scope).trim();
  return (
    <Frame>
      <Bubble>{rendered || <span className="opacity-50">Your message appears here</span>}</Bubble>
    </Frame>
  );
}

export function InteractivePreview({ config }: { config: Record<string, unknown> }) {
  const scope = useSampleScope();
  const options = ((config.options as InteractiveOption[]) ?? []).filter((o) => o.title?.trim());
  let mode: "buttons" | "list" | "text" = "list";
  try {
    mode = resolveInteractiveMode({ ...(config as unknown as InteractiveConfig), options });
  } catch {}
  const r = (v: unknown) => renderTemplate(typeof v === "string" ? v : "", scope);
  const body = r(config.body).trim();
  return (
    <Frame>
      <div className="max-w-[92%] space-y-1">
        <Bubble>
          {r(config.header) && <div className="mb-1 font-semibold">{r(config.header)}</div>}
          {body || <span className="opacity-50">Question text</span>}
          {mode === "text" && options.length > 0 && <div className="mt-2">{numberedOptionsText(options)}</div>}
          {r(config.footer) && <div className="mt-1 text-[11px] opacity-60">{r(config.footer)}</div>}
        </Bubble>
        {mode === "buttons" &&
          options.map((o) => (
            <div key={o.id} className="rounded-xl bg-white py-2 text-center text-[13px] font-medium text-[#008069] shadow-sm dark:bg-[#202c33] dark:text-[#21c063]">
              {o.title}
            </div>
          ))}
        {mode === "list" && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[13px] font-medium text-[#008069] shadow-sm dark:bg-[#202c33] dark:text-[#21c063]">
            <List className="size-3.5" /> {r(config.buttonText) || "Choose"}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[#54656f] dark:text-[#8696a0]">
        Sent as {mode === "buttons" ? "reply buttons" : mode === "list" ? "a list" : "numbered text"}. Customers can also reply with the option number.
      </p>
    </Frame>
  );
}
