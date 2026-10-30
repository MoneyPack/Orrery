import { describe, expect, it, vi } from "vitest";
import {
  allOf,
  allow,
  audited,
  deny,
  enforce,
  type Permission,
  type PermissionAuditRecord,
} from "./permission";
import { capabilities, toArray } from "./capabilities";
import { containerEnforcementPermission, profilePermission } from "./capability-permission";

describe("Permission<T>", () => {
  it("builds allow and deny decisions", () => {
    expect(allow()).toEqual({ allowed: true, grant: true });
    expect(allow({ nonce: "n" })).toEqual({ allowed: true, grant: { nonce: "n" } });
    expect(deny("no")).toEqual({ allowed: false, reason: "no" });
  });

  it("enforce returns the grant or throws the reason, optionally mapped to a fixed error", () => {
    expect(enforce(allow(7))).toBe(7);
    expect(() => enforce(deny("missing write"))).toThrow("missing write");
    expect(() => enforce(deny("internal detail"), () => new Error("Rejected"))).toThrow(/^Rejected$/);
  });

  it("allOf short-circuits on the first denial", () => {
    const second = vi.fn(() => allow());
    const permission = allOf<number>("combined", n => (n > 0 ? allow() : deny("not positive")), second);
    expect(permission.check(1)).toEqual(allow());
    expect(second).toHaveBeenCalledOnce();
    expect(permission.check(-1)).toEqual(deny("not positive"));
    expect(second).toHaveBeenCalledOnce();
    expect(permission.system).toBe("combined");
  });

  describe("audited", () => {
    const base: Permission<string, string, string, string> = {
      system: "test",
      check: subject => (subject === "ok" ? allow("grant") : deny("refused")),
      approve: subject => `token:${subject}`,
      revoke: () => undefined,
    };

    it("records every outcome without changing decisions", () => {
      const records: PermissionAuditRecord[] = [];
      const permission = audited(base, record => records.push(record), subject => `subject=${subject}`, handle => `handle=${handle}`);
      expect(permission.check("ok")).toEqual(allow("grant"));
      expect(permission.check("bad")).toEqual(deny("refused"));
      expect(permission.approve?.("ok")).toBe("token:ok");
      permission.revoke?.("n1");
      expect(records).toEqual([
        { system: "test", outcome: "allowed", subject: "subject=ok" },
        { system: "test", outcome: "denied", subject: "subject=bad", reason: "refused" },
        { system: "test", outcome: "approved", subject: "subject=ok" },
        { system: "test", outcome: "revoked", subject: "handle=n1" },
      ]);
    });

    it("isolates a failing sink so auditing cannot flip a decision", () => {
      const permission = audited(base, () => { throw new Error("disk full"); });
      expect(permission.check("ok")).toEqual(allow("grant"));
      expect(permission.check("bad")).toEqual(deny("refused"));
    });

    it("does not invent approve or revoke for systems without them", () => {
      const checkOnly: Permission<string> = { system: "check-only", check: () => allow() };
      const permission = audited(checkOnly, () => undefined);
      expect(permission.approve).toBeUndefined();
      expect(permission.revoke).toBeUndefined();
    });

    it("does not record an approval or revocation that threw", () => {
      const records: PermissionAuditRecord[] = [];
      const failing: Permission<string, true, string, string> = {
        system: "failing",
        check: () => allow(),
        approve: () => { throw new Error("invalid"); },
        revoke: () => { throw new Error("unknown"); },
      };
      const permission = audited(failing, record => records.push(record));
      expect(() => permission.approve?.("x")).toThrow("invalid");
      expect(() => permission.revoke?.("x")).toThrow("unknown");
      expect(records).toEqual([]);
    });
  });
});

describe("profile capability permission", () => {
  it("checks with authorize semantics", () => {
    const profile = profilePermission(capabilities(["read", "write"]));
    const ok = profile.check(capabilities(["read"]));
    expect(ok.allowed).toBe(true);
    const denied = profile.check(capabilities(["read", "network"]));
    expect(denied).toEqual(deny("Missing capabilities: network"));
  });

  it("approve escalates the grant and reports only what was added", () => {
    const profile = profilePermission(capabilities(["read"]));
    expect(toArray(profile.approve(capabilities(["read", "network"])))).toEqual(["network"]);
    expect(profile.check(capabilities(["network"])).allowed).toBe(true);
    expect(toArray(profile.approve(capabilities(["read"])))).toEqual([]);
  });

  it("approve never grants more than the prior grant plus its input", () => {
    const profile = profilePermission(capabilities(["read"]));
    const before = toArray(profile.granted);
    const requested = capabilities(["read", "network"]);
    profile.approve(requested);
    expect(new Set(toArray(profile.granted))).toEqual(new Set([...before, ...toArray(requested)]));
  });

  it("revoke withdraws capabilities from later checks", () => {
    const profile = profilePermission(capabilities(["read", "write", "network"]));
    profile.revoke(capabilities(["network"]));
    expect(toArray(profile.granted)).toEqual(["read", "write"]);
    expect(profile.check(capabilities(["network"])).allowed).toBe(false);
  });
});

describe("container enforcement permission", () => {
  it("passes when observed enforcement is within the profile", () => {
    const decision = containerEnforcementPermission.check({ profile: capabilities(["read", "write"]), observed: capabilities(["read"]) });
    expect(decision.allowed).toBe(true);
  });

  it("denies and names capabilities the runtime permits beyond the profile", () => {
    const decision = containerEnforcementPermission.check({ profile: capabilities(["read"]), observed: capabilities(["read", "network", "privileged"]) });
    expect(decision).toEqual(deny("Runtime enforcement exceeds profile: network, privileged"));
  });

  it("offers no approve or revoke: enforcement is observed, not granted", () => {
    expect(containerEnforcementPermission.approve).toBeUndefined();
    expect(containerEnforcementPermission.revoke).toBeUndefined();
  });
});
