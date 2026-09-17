import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PinnedApprovalVerifier, TrustedApprovalService, approvalKeyFingerprint, approvalPrincipal } from "./promotion-approval";

const request = { missionId: "mission-1", planRevisionId: "plan-1", changeRevision: "change-1", decision: "accepted" as const, contentDigest: "a".repeat(64) };

describe("native promotion approval", () => {
  it("pins verification material and derives a canonical reviewer principal from it", () => {
    const issuer = new TrustedApprovalService({ now: () => "2026-08-29T10:00:00.000Z", id: () => "nonce-1" });
    const verifier = new PinnedApprovalVerifier(issuer.approvalKey, { now: () => "2026-08-29T10:00:01.000Z" });
    expect(verifier.verify({ ...request, capability: issuer.issue(request) })).toEqual({
      nonce: "nonce-1", expiresAt: "2026-08-29T10:01:00.000Z", reviewerId: approvalPrincipal(issuer.approvalKey),
    });
    expect(approvalPrincipal(issuer.approvalKey)).toMatch(/^electron-[0-9a-f]{32}$/);
    expect(approvalKeyFingerprint(issuer.approvalKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalKeyFingerprint(issuer.approvalKey).startsWith(approvalPrincipal(issuer.approvalKey).slice("electron-".length))).toBe(true);
  });

  it("generates a high-entropy 32-byte base64url key by default and honors an injected one", () => {
    const generated = new TrustedApprovalService();
    expect(Buffer.from(generated.approvalKey, "base64url")).toHaveLength(32);
    expect(new TrustedApprovalService().approvalKey).not.toBe(generated.approvalKey);
    const injected = new TrustedApprovalService({ approvalKey: Buffer.alloc(32, 7).toString("base64url") });
    expect(injected.approvalKey).toBe(Buffer.alloc(32, 7).toString("base64url"));
    expect(() => new TrustedApprovalService({ approvalKey: "too-short" })).toThrow(/approval key/i);
    expect(() => new PinnedApprovalVerifier("too-short")).toThrow(/approval key/i);
  });

  it("does not reload or accept replacement verification material", () => {
    const first = new TrustedApprovalService({ now: () => "2026-08-29T10:00:00.000Z" });
    const replacement = new TrustedApprovalService({ now: () => "2026-08-29T10:00:00.000Z" });
    const verifier = new PinnedApprovalVerifier(first.approvalKey, { now: () => "2026-08-29T10:00:01.000Z" });
    expect(() => verifier.verify({ ...request, capability: replacement.issue(request) })).toThrow(/capability/i);
  });

  it("enforces exact schema, HMAC, tuple, digest, clock, nonce, and maximum lifetime", () => {
    let now = "2026-08-29T10:00:00.000Z";
    const issuer = new TrustedApprovalService({ now: () => now, maximumTtlMs: 1_000 });
    const verifier = new PinnedApprovalVerifier(issuer.approvalKey, { now: () => now, maximumTtlMs: 1_000, maximumClockSkewMs: 100 });
    const valid = issuer.issue(request);
    expect(() => verifier.verify({ ...request, contentDigest: "b".repeat(64), capability: valid })).toThrow(/match/i);
    const [encoded, tag] = valid.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(payload.nonce).toEqual(expect.any(String));
    const extra = `${Buffer.from(JSON.stringify({ ...payload, reviewerId: "attacker" })).toString("base64url")}.${tag}`;
    expect(() => verifier.verify({ ...request, capability: extra })).toThrow(/capability|schema/i);
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, decision: "rejected" })).toString("base64url")}.${tag}`;
    expect(() => verifier.verify({ ...request, capability: tampered })).toThrow(/capability/i);
    expect(() => verifier.verify({ ...request, capability: `${encoded}.${"A".repeat(43)}` })).toThrow(/capability/i);
    const withoutNonce = { ...payload } as Record<string, unknown>;
    delete withoutNonce.nonce;
    const encodedWithoutNonce = Buffer.from(JSON.stringify(withoutNonce)).toString("base64url");
    const resealed = `${encodedWithoutNonce}.${createHmac("sha256", Buffer.from(issuer.approvalKey, "base64url")).update(encodedWithoutNonce, "utf8").digest("base64url")}`;
    expect(() => verifier.verify({ ...request, capability: resealed })).toThrow(/schema/i);
    now = "2026-08-29T10:00:01.000Z";
    expect(() => verifier.verify({ ...request, capability: valid })).toThrow(/expired/i);
  });

  it("rejects capabilities issued too far in the future or beyond maximum TTL", () => {
    const issuer = new TrustedApprovalService({ now: () => "2026-08-29T10:00:01.000Z", maximumTtlMs: 2_000 });
    const verifier = new PinnedApprovalVerifier(issuer.approvalKey, { now: () => "2026-08-29T10:00:00.000Z", maximumTtlMs: 1_000, maximumClockSkewMs: 100 });
    expect(() => verifier.verify({ ...request, capability: issuer.issue(request) })).toThrow(/clock|lifetime/i);
  });
});
