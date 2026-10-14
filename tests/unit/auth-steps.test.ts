import { describe, expect, it } from "vitest";
import { resolveAuthStep, roleAllows } from "@/lib/auth/steps";
import { loginToAuthEmail, LOGIN_ID_DOMAIN } from "@/lib/auth/login-id";

const active = { status: "active" as const, role: "admin" as const };

describe("MFA sign-in steps (acceptance 1–3)", () => {
  it("1. a new admin without a verified factor is sent to QR enrollment", () => {
    expect(resolveAuthStep({ userId: "u", profile: { ...active, status: "invited" }, verifiedTotpFactors: 0, aal: "aal1" })).toBe(
      "enroll",
    );
  });

  it("1. once a factor is verified the QR enrollment step is never shown again", () => {
    expect(resolveAuthStep({ userId: "u", profile: active, verifiedTotpFactors: 1, aal: "aal1" })).toBe("verify");
  });

  it("2. a returning admin with a verified factor only sees the 6-digit code prompt", () => {
    expect(resolveAuthStep({ userId: "u", profile: active, verifiedTotpFactors: 2, aal: "aal1" })).toBe("verify");
  });

  it("3. users without verified MFA never reach the dashboard", () => {
    for (const aal of [null, "aal1"]) {
      expect(resolveAuthStep({ userId: "u", profile: active, verifiedTotpFactors: 0, aal })).not.toBe("ok");
      expect(resolveAuthStep({ userId: "u", profile: active, verifiedTotpFactors: 1, aal })).not.toBe("ok");
    }
    expect(resolveAuthStep({ userId: "u", profile: active, verifiedTotpFactors: 1, aal: "aal2" })).toBe("ok");
  });

  it("denies unknown or disabled accounts and signed-out visitors", () => {
    expect(resolveAuthStep({ userId: null, profile: null, verifiedTotpFactors: 0, aal: null })).toBe("login");
    expect(resolveAuthStep({ userId: "u", profile: null, verifiedTotpFactors: 1, aal: "aal2" })).toBe("denied");
    expect(resolveAuthStep({ userId: "u", profile: { ...active, status: "disabled" }, verifiedTotpFactors: 1, aal: "aal2" })).toBe(
      "denied",
    );
  });

  it("enforces the role hierarchy", () => {
    expect(roleAllows("owner", "admin")).toBe(true);
    expect(roleAllows("admin", "admin")).toBe(true);
    expect(roleAllows("staff", "admin")).toBe(false);
    expect(roleAllows("staff", "staff")).toBe(true);
  });
});

describe("login IDs", () => {
  it("keeps real emails and maps login IDs deterministically", () => {
    expect(loginToAuthEmail("Admin@Example.com")).toBe("admin@example.com");
    expect(loginToAuthEmail("Gayathri@2026")).toBe(`gayathri-2026@${LOGIN_ID_DOMAIN}`);
    expect(loginToAuthEmail(" gayathri@2026 ")).toBe(loginToAuthEmail("Gayathri@2026"));
  });
});
