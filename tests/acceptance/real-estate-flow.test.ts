import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import { validateFlow } from "@/lib/engine/validate-graph";
import { buildRealEstateFlowDefinition, REAL_ESTATE_FLOW_NAME, REAL_ESTATE_FLOW_PRIORITY } from "@/lib/flows/real-estate-flow";

const QUESTIONS = [
  "Will you generate leads, handle calls, and convert prospects into site visit bookings?",
  "How do you follow up with leads and schedule site visits?",
  "Can you handle a high volume of enquiries for our real estate project?",
  "How do you track lead status and keep us updated on conversions and site visit bookings?",
];

/** Main enquiry flow (priority 100) plus the real estate ad flow, as in production. */
function setup() {
  const h = createHarness();
  h.store.addFlow({ name: REAL_ESTATE_FLOW_NAME, status: "active", priority: REAL_ESTATE_FLOW_PRIORITY, definition: buildRealEstateFlowDefinition() });
  return h;
}

/** Sends an ad question and lets the 5-second pause pass. */
async function askAndWait(h: ReturnType<typeof setup>, question = QUESTIONS[0]) {
  await h.say(question);
  h.clock.advance(5);
  await h.runDueJobs();
}

describe("Real estate — Facebook ad questions flow", () => {
  it("is a valid flow", () => {
    expect(validateFlow(buildRealEstateFlowDefinition()).errors).toEqual([]);
  });

  it.each(QUESTIONS)("answers “%s” after 5 seconds with Yes / No buttons", async (question) => {
    const h = setup();
    await h.say(question);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.scheduler.scheduled[0].delaySeconds).toBe(5);
    h.clock.advance(5);
    await h.runDueJobs();
    const last = h.sender.sent.at(-1)!.message;
    expect(last.kind).toBe("buttons");
    if (last.kind === "buttons") {
      expect(last.body).toContain("Great question!");
      expect(last.buttons.map((b) => b.title)).toEqual(["Yes 👍", "No 🙏"]);
    }
  });

  it("does not catch a normal “Hi” — that still gets the main welcome", async () => {
    const h = setup();
    await h.say("Hi");
    expect(h.sender.texts()[0]).toContain("Welcome to Star Growth Hub!");
  });

  it("Yes → asks name and business, saves a qualified lead and thanks the customer", async () => {
    const h = setup();
    await askAndWait(h, QUESTIONS[2]);
    await h.select("discuss_yes", "Yes 👍");
    expect(h.sender.texts().at(-1)).toBe("Wonderful! 😊 May I know your name, please?");
    await h.say("Ravi Kumar");
    expect(h.sender.texts().at(-1)).toBe("Thanks, Ravi Kumar! 🙌 What's your business or company name?");
    await h.say("Skyline Homes");
    expect(h.sender.texts().at(-1)).toContain("Thank you, Ravi Kumar! 🎉");
    expect(h.sender.texts().at(-1)).toContain("*Skyline Homes*");
    expect(h.lead()).toMatchObject({
      name: "Ravi Kumar",
      businessName: "Skyline Homes",
      service: "Real Estate Lead Generation",
      requirements: QUESTIONS[2],
      status: "qualified",
    });
    expect(h.execution().status).toBe("completed");
  });

  it("typing “yes” works as well as tapping the button", async () => {
    const h = setup();
    await askAndWait(h);
    await h.say("yes");
    expect(h.sender.texts().at(-1)).toBe("Wonderful! 😊 May I know your name, please?");
  });

  it("No → says thank you politely and creates no lead", async () => {
    const h = setup();
    await askAndWait(h, QUESTIONS[1]);
    await h.say("no");
    expect(h.sender.texts().at(-1)).toContain("No problem at all!");
    expect(h.lead()).toBeUndefined();
    expect(h.execution().status).toBe("completed");
  });

  it("an unclear reply is re-asked once, then the team takes over", async () => {
    const h = setup();
    await askAndWait(h);
    await h.say("what is the price?");
    expect(h.sender.texts().at(-1)).toBe("Please tap *Yes* or *No* above, or reply 1 or 2 🙂");
    await h.say("call me");
    expect(h.sender.texts().at(-1)).toContain("connect you with our team");
    expect(h.execution().status).toBe("handoff");
  });
});
