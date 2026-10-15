import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import type { FlowDefinition, FlowEdge, FlowNode, NodeType } from "@/lib/engine/schema";
import { parseTime, timeLabel, zonedToUtc } from "@/lib/engine/booking";
import { buildMessagePayload } from "@/lib/whatsapp/payload";

const node = (id: string, type: NodeType, config: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: "", config } });
const edge = (source: string, target: string, sourceHandle = "out"): FlowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle });

// Harness clock: Wed 14 Oct 2026, 10:00 UTC = 15:30 in India, so today's 10:00–12:00 slots are over.
function bookingFlow(extra: Record<string, unknown> = {}): FlowDefinition {
  return {
    nodes: [
      node("t", "trigger"),
      node("b", "booking", { service: "Site visit", startTime: "10:00", endTime: "12:00", slotMinutes: 30, daysAhead: 3, ...extra }),
      node("ok", "send_message", { text: "See you {{vars.booking}}" }),
      node("none", "send_message", { text: "We'll call you instead." }),
    ],
    edges: [edge("t", "b"), edge("b", "ok", "booked"), edge("b", "none", "no_slots")],
  };
}

function lastList(h: ReturnType<typeof createHarness>) {
  const m = h.sender.sent.at(-1)!.message;
  if (m.kind !== "list") throw new Error(`expected a list, got ${m.kind}`);
  return m;
}

describe("Booking", () => {
  it("offers free days, then free times, and books the chosen slot", async () => {
    const h = createHarness({ definition: bookingFlow() });
    await h.say("Hi");
    expect(lastList(h).rows.map((r) => r.id)).toEqual(["d:2026-10-15", "d:2026-10-16"]);
    expect(lastList(h).rows[0]).toMatchObject({ title: "Thu, 15 Oct", description: "4 times free" });

    await h.select("d:2026-10-15", "Thu, 15 Oct");
    expect(lastList(h).body).toBe("What time on Thu, 15 Oct 2026?");
    expect(lastList(h).rows.map((r) => r.id)).toEqual(["t:10:00", "t:10:30", "t:11:00", "t:11:30", "back"]);

    await h.select("t:10:30", "10:30 AM");
    const texts = h.sender.texts();
    expect(texts.at(-2)).toBe("✅ You're booked for Thu, 15 Oct 2026 at 10:30 AM. See you then!");
    expect(texts.at(-1)).toBe("See you Thu, 15 Oct 2026 at 10:30 AM");
    const [booking] = [...h.store.bookings.values()];
    expect(booking).toMatchObject({ service: "Site visit", startsAt: "2026-10-15T05:00:00.000Z", status: "booked" });
    expect(h.store.notifications.some((n) => n.kind === "booking_created" && n.body?.includes("Thu, 15 Oct 2026 at 10:30 AM"))).toBe(true);
  });

  it("understands typed days and times, and never overbooks a slot", async () => {
    const h = createHarness({ definition: bookingFlow() });
    await h.say("Hi");
    await h.say("tomorrow");
    await h.say("11am");
    expect(h.sender.texts().at(-1)).toBe("See you Thu, 15 Oct 2026 at 11:00 AM");

    // Another customer no longer sees 11:00 that day.
    await h.say("Hi", { from: "919800000001" });
    await h.select("d:2026-10-15", "Thu, 15 Oct");
    expect(lastList(h).rows.map((r) => r.id)).not.toContain("t:11:00");
  });

  it("asks again when the chosen time is no longer free", async () => {
    const h = createHarness({ definition: bookingFlow() });
    await h.say("Hi");
    await h.select("d:2026-10-15", "Thu, 15 Oct");
    // Someone else takes 10:00 IST (04:30 UTC) while this customer looks at the list.
    h.store.bookings.set("other", {
      id: "other",
      calendar: "main",
      executionId: null,
      nodeId: null,
      contactId: "c",
      conversationId: "v",
      service: null,
      startsAt: "2026-10-15T04:30:00.000Z",
      endsAt: "2026-10-15T05:00:00.000Z",
      status: "booked",
      isTest: false,
      reminder: null,
    });
    await h.select("t:10:00", "10:00 AM");
    expect(lastList(h).body).toContain("10:00 AM isn't free on that day");
    expect(lastList(h).rows.map((r) => r.id)).not.toContain("t:10:00");

    // Race: the list still showed it free, but the booking itself is refused.
    const count = h.store.countBookings.bind(h.store);
    h.store.countBookings = async () => new Map();
    await h.select("t:10:00", "10:00 AM");
    h.store.countBookings = count;
    expect(lastList(h).body).toContain("Sorry, that time was just taken");
    expect(h.execution().status).toBe("waiting_input");
  });

  it("takes the No slots branch when nothing is free", async () => {
    const h = createHarness({ definition: bookingFlow({ daysAhead: 1 }) });
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["Sorry, there are no free times in the next few days. Our team will contact you.", "We'll call you instead."]);
  });

  it("pages through long days and goes back to the day list", async () => {
    const h = createHarness({ definition: bookingFlow({ endTime: "18:00" }) });
    await h.say("Hi");
    await h.select("d:2026-10-16", "Fri, 16 Oct");
    expect(lastList(h).rows.map((r) => r.id)).toEqual(["t:10:00", "t:10:30", "t:11:00", "t:11:30", "t:12:00", "t:12:30", "t:13:00", "t:13:30", "more:8", "back"]);
    await h.select("more:8", "Later times ›");
    expect(lastList(h).rows[0].id).toBe("t:14:00");
    await h.select("back", "‹ Another day");
    // Open until 18:00, so today (after the 1-hour notice, from 16:30) is offered too.
    expect(lastList(h).rows[0]).toMatchObject({ id: "d:2026-10-14", description: "3 times free" });
  });

  it("reminds the customer: a message inside the 24-hour window, a template after it", async () => {
    const h = createHarness({ definition: bookingFlow({ reminderHours: 2, reminderTemplate: "appointment_reminder" }) });
    await h.say("Hi");
    await h.select("d:2026-10-15", "Thu, 15 Oct");
    await h.select("t:10:30", "10:30 AM");
    const job = [...h.store.jobs.values()].find((j) => j.kind === "booking_reminder")!;
    expect(job.runAt).toBe("2026-10-15T03:00:00.000Z"); // 2 h before 10:30 IST
    h.clock.advance(17 * 3600);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("Reminder: your appointment is on Thu, 15 Oct 2026 at 10:30 AM. Reply here if you need to change it.");

    const late = createHarness({ definition: bookingFlow({ reminderHours: 2, reminderTemplate: "appointment_reminder" }) });
    await late.say("Hi");
    await late.select("d:2026-10-16", "Fri, 16 Oct");
    await late.select("t:10:30", "10:30 AM");
    late.clock.advance(41 * 3600);
    await late.runDueJobs();
    expect(late.sender.sent.at(-1)!.message).toEqual({
      kind: "template",
      name: "appointment_reminder",
      language: "en",
      bodyParams: ["Fri, 16 Oct 2026 at 10:30 AM"],
    });
  });

  it("does not remind about cancelled bookings", async () => {
    const h = createHarness({ definition: bookingFlow({ reminderHours: 2 }) });
    await h.say("Hi");
    await h.select("d:2026-10-15", "Thu, 15 Oct");
    await h.select("t:10:30", "10:30 AM");
    [...h.store.bookings.values()][0].status = "cancelled";
    const sent = h.sender.sent.length;
    h.clock.advance(17 * 3600);
    await h.runDueJobs();
    expect(h.sender.sent.length).toBe(sent);
  });
});

describe("Send template", () => {
  it("sends even after the 24-hour window has closed", async () => {
    const h = createHarness({
      definition: {
        nodes: [
          node("t", "trigger"),
          node("w", "wait", { amount: 25, unit: "hours" }),
          node("tpl", "send_template", { name: "follow_up", language: "en_US", bodyParams: ["{{contact.name|there}}"] }),
        ],
        edges: [edge("t", "w"), edge("w", "tpl")],
      },
    });
    await h.say("Hi");
    h.clock.advance(25 * 3600);
    await h.runDueJobs();
    expect(h.sender.sent.at(-1)!.message).toEqual({ kind: "template", name: "follow_up", language: "en_US", bodyParams: ["there"] });
    expect(buildMessagePayload("919800000000", h.sender.sent.at(-1)!.message)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919800000000",
      type: "template",
      template: { name: "follow_up", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text", text: "there" }] }] },
    });
  });
});

describe("Booking helpers", () => {
  it("converts business-time slots to UTC and reads typed times", () => {
    expect(zonedToUtc("2026-10-15", "10:30", "Asia/Kolkata").toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(parseTime("10am")).toBe("10:00");
    expect(parseTime("4:30 pm")).toBe("16:30");
    expect(parseTime("12 am")).toBe("00:00");
    expect(parseTime("25:00")).toBeNull();
    expect(timeLabel("16:30")).toBe("4:30 PM");
    expect(timeLabel("00:15")).toBe("12:15 AM");
  });
});
