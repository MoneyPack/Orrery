import { describe, it, expect } from "vitest";
import {
  capabilities,
  union,
  intersection,
  difference,
  isSubsetOf,
  equals,
  isEmpty,
  deriveCapabilities,
  authorize,
  delegate,
  revoke,
  checkEscalation,
  toArray,
  fromArray,
  containsHighRisk,
  HIGH_RISK_CAPABILITIES,
  type CapabilitySet,
  type ExecutionCapability,
} from "./capabilities";

describe("Capability Calculus", () => {
  describe("Basic Set Operations", () => {
    it("creates a capability set from an array", () => {
      const set = capabilities(["read", "write"]);
      expect(set.capabilities.has("read")).toBe(true);
      expect(set.capabilities.has("write")).toBe(true);
      expect(set.capabilities.size).toBe(2);
    });

    it("removes duplicates when creating sets", () => {
      const set = capabilities(["read", "read", "write"]);
      expect(set.capabilities.size).toBe(2);
    });

    it("computes union of two sets", () => {
      const a = capabilities(["read", "write"]);
      const b = capabilities(["write", "destructive"]);
      const result = union(a, b);
      expect(toArray(result)).toEqual(["destructive", "read", "write"]);
    });

    it("computes intersection of two sets", () => {
      const a = capabilities(["read", "write", "network"]);
      const b = capabilities(["write", "network", "secret"]);
      const result = intersection(a, b);
      expect(toArray(result)).toEqual(["network", "write"]);
    });

    it("computes difference of two sets", () => {
      const a = capabilities(["read", "write", "network"]);
      const b = capabilities(["write", "secret"]);
      const result = difference(a, b);
      expect(toArray(result)).toEqual(["network", "read"]);
    });

    it("handles empty set operations", () => {
      const empty = capabilities([]);
      const some = capabilities(["read", "write"]);
      
      expect(isEmpty(empty)).toBe(true);
      expect(isEmpty(some)).toBe(false);
      expect(toArray(union(empty, some))).toEqual(["read", "write"]);
      expect(isEmpty(intersection(empty, some))).toBe(true);
      expect(toArray(difference(some, empty))).toEqual(["read", "write"]);
    });
  });

  describe("Subset and Equality", () => {
    it("checks if one set is a subset of another", () => {
      const small = capabilities(["read", "write"]);
      const large = capabilities(["read", "write", "network"]);
      
      expect(isSubsetOf(small, large)).toBe(true);
      expect(isSubsetOf(large, small)).toBe(false);
    });

    it("considers a set a subset of itself", () => {
      const set = capabilities(["read", "write"]);
      expect(isSubsetOf(set, set)).toBe(true);
    });

    it("considers empty set a subset of any set", () => {
      const empty = capabilities([]);
      const some = capabilities(["read"]);
      expect(isSubsetOf(empty, some)).toBe(true);
    });

    it("checks equality of two sets", () => {
      const a = capabilities(["read", "write"]);
      const b = capabilities(["write", "read"]); // order shouldn't matter
      const c = capabilities(["read"]);
      
      expect(equals(a, b)).toBe(true);
      expect(equals(a, c)).toBe(false);
    });
  });

  describe("Capability Derivation", () => {
    it("derives read capability from file modifications", () => {
      const derived = deriveCapabilities({ modifiesFiles: true });
      expect(toArray(derived)).toEqual(["read", "write"]);
    });

    it("derives read capability from file deletions", () => {
      const derived = deriveCapabilities({ deletesFiles: true });
      expect(toArray(derived)).toEqual(["destructive", "read"]);
    });

    it("derives network capability", () => {
      const derived = deriveCapabilities({ requiresNetwork: true });
      expect(toArray(derived)).toEqual(["network"]);
    });

    it("derives multiple capabilities", () => {
      const derived = deriveCapabilities({
        modifiesFiles: true,
        requiresNetwork: true,
        accessesSecrets: true,
      });
      expect(toArray(derived)).toEqual(["network", "read", "secret", "write"]);
    });

    it("derives all high-risk capabilities", () => {
      const derived = deriveCapabilities({
        deletesFiles: true,
        requiresNetwork: true,
        accessesSecrets: true,
        spendsMoney: true,
        requiresPrivileged: true,
      });
      expect(toArray(derived)).toEqual([
        "destructive",
        "network",
        "privileged",
        "read",
        "secret",
        "spend",
      ]);
    });

    it("returns empty set when no characteristics are set", () => {
      const derived = deriveCapabilities({});
      expect(isEmpty(derived)).toBe(true);
    });
  });

  describe("Authorization", () => {
    it("authorizes when requested is subset of granted", () => {
      const requested = capabilities(["read", "write"]);
      const granted = capabilities(["read", "write", "network"]);
      const result = authorize(requested, granted);
      
      expect(result.authorized).toBe(true);
      expect(result.missing).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("denies when requested exceeds granted", () => {
      const requested = capabilities(["read", "write", "network"]);
      const granted = capabilities(["read", "write"]);
      const result = authorize(requested, granted);
      
      expect(result.authorized).toBe(false);
      expect(result.missing).toBeDefined();
      expect(toArray(result.missing!)).toEqual(["network"]);
      expect(result.reason).toContain("network");
    });

    it("authorizes empty request", () => {
      const requested = capabilities([]);
      const granted = capabilities(["read", "write"]);
      const result = authorize(requested, granted);
      
      expect(result.authorized).toBe(true);
    });

    it("denies non-empty request with empty grant", () => {
      const requested = capabilities(["read"]);
      const granted = capabilities([]);
      const result = authorize(requested, granted);
      
      expect(result.authorized).toBe(false);
      expect(toArray(result.missing!)).toEqual(["read"]);
    });

    it("lists all missing capabilities in denial reason", () => {
      const requested = capabilities(["read", "write", "network", "secret"]);
      const granted = capabilities(["read"]);
      const result = authorize(requested, granted);
      
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("network");
      expect(result.reason).toContain("secret");
      expect(result.reason).toContain("write");
    });
  });

  describe("Delegation", () => {
    it("delegates capabilities that exist in source", () => {
      const source = capabilities(["read", "write", "network"]);
      const requested = capabilities(["read", "write"]);
      const delegated = delegate(source, requested);
      
      expect(toArray(delegated)).toEqual(["read", "write"]);
    });

    it("cannot delegate capabilities not in source", () => {
      const source = capabilities(["read", "write"]);
      const requested = capabilities(["read", "network"]);
      const delegated = delegate(source, requested);
      
      expect(toArray(delegated)).toEqual(["read"]);
    });

    it("delegates nothing when source and requested are disjoint", () => {
      const source = capabilities(["read", "write"]);
      const requested = capabilities(["network", "secret"]);
      const delegated = delegate(source, requested);
      
      expect(isEmpty(delegated)).toBe(true);
    });
  });

  describe("Revocation", () => {
    it("removes specified capabilities", () => {
      const from = capabilities(["read", "write", "network"]);
      const toRevoke = capabilities(["write", "network"]);
      const result = revoke(from, toRevoke);
      
      expect(toArray(result)).toEqual(["read"]);
    });

    it("handles revoking capabilities not present", () => {
      const from = capabilities(["read", "write"]);
      const toRevoke = capabilities(["network", "secret"]);
      const result = revoke(from, toRevoke);
      
      expect(toArray(result)).toEqual(["read", "write"]);
    });

    it("can revoke all capabilities", () => {
      const from = capabilities(["read", "write"]);
      const result = revoke(from, from);
      
      expect(isEmpty(result)).toBe(true);
    });
  });

  describe("Escalation Detection", () => {
    it("detects no escalation when sets are equal", () => {
      const old = capabilities(["read", "write"]);
      const newSet = capabilities(["read", "write"]);
      const result = checkEscalation(old, newSet);
      
      expect(result.isEscalation).toBe(false);
      expect(result.addedCapabilities).toBeUndefined();
    });

    it("detects no escalation when new is subset of old", () => {
      const old = capabilities(["read", "write", "network"]);
      const newSet = capabilities(["read", "write"]);
      const result = checkEscalation(old, newSet);
      
      expect(result.isEscalation).toBe(false);
    });

    it("detects escalation when new adds capabilities", () => {
      const old = capabilities(["read", "write"]);
      const newSet = capabilities(["read", "write", "network"]);
      const result = checkEscalation(old, newSet);
      
      expect(result.isEscalation).toBe(true);
      expect(toArray(result.addedCapabilities!)).toEqual(["network"]);
    });

    it("detects multiple added capabilities", () => {
      const old = capabilities(["read"]);
      const newSet = capabilities(["read", "write", "network", "secret"]);
      const result = checkEscalation(old, newSet);
      
      expect(result.isEscalation).toBe(true);
      expect(toArray(result.addedCapabilities!)).toEqual(["network", "secret", "write"]);
    });
  });

  describe("Serialization", () => {
    it("converts capability set to sorted array", () => {
      const set = capabilities(["write", "network", "read"]);
      const arr = toArray(set);
      
      expect(arr).toEqual(["network", "read", "write"]);
    });

    it("round-trips through array serialization", () => {
      const original = capabilities(["destructive", "read", "write"]);
      const arr = toArray(original);
      const restored = fromArray(arr);
      
      expect(equals(original, restored)).toBe(true);
    });

    it("handles empty set serialization", () => {
      const empty = capabilities([]);
      expect(toArray(empty)).toEqual([]);
      expect(isEmpty(fromArray(toArray(empty)))).toBe(true);
    });
  });

  describe("High-Risk Capabilities", () => {
    it("identifies high-risk capability set contents", () => {
      expect(toArray(HIGH_RISK_CAPABILITIES)).toEqual([
        "destructive",
        "network",
        "privileged",
        "secret",
        "spend",
      ]);
    });

    it("detects when set contains high-risk capabilities", () => {
      const withRisk = capabilities(["read", "write", "network"]);
      const withoutRisk = capabilities(["read", "write"]);
      
      expect(containsHighRisk(withRisk)).toBe(true);
      expect(containsHighRisk(withoutRisk)).toBe(false);
    });

    it("detects multiple high-risk capabilities", () => {
      const set = capabilities(["read", "destructive", "secret", "privileged"]);
      expect(containsHighRisk(set)).toBe(true);
    });

    it("returns false for empty set", () => {
      expect(containsHighRisk(capabilities([]))).toBe(false);
    });
  });

  describe("Complex Scenarios", () => {
    it("handles profile authorization with capability derivation", () => {
      // Profile grants read, write, destructive
      const profileCaps = capabilities(["read", "write", "destructive"]);
      
      // Command wants to delete files
      const commandCaps = deriveCapabilities({ deletesFiles: true });
      
      const result = authorize(commandCaps, profileCaps);
      expect(result.authorized).toBe(true);
    });

    it("denies command requiring network when profile lacks it", () => {
      const profileCaps = capabilities(["read", "write"]);
      const commandCaps = deriveCapabilities({ 
        modifiesFiles: true, 
        requiresNetwork: true 
      });
      
      const result = authorize(commandCaps, profileCaps);
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("network");
    });

    it("supports capability delegation chain", () => {
      // Root profile has all capabilities
      const root = capabilities(["read", "write", "destructive", "network", "secret"]);
      
      // Delegate read/write/destructive to session
      const sessionCaps = delegate(root, capabilities(["read", "write", "destructive"]));
      
      // Session tries to delegate network (which it doesn't have)
      const commandCaps = delegate(sessionCaps, capabilities(["read", "network"]));
      
      expect(toArray(commandCaps)).toEqual(["read"]);
    });

    it("supports incremental capability escalation detection", () => {
      const initial = capabilities(["read"]);
      const afterWrite = capabilities(["read", "write"]);
      const afterNetwork = capabilities(["read", "write", "network"]);
      
      const step1 = checkEscalation(initial, afterWrite);
      expect(step1.isEscalation).toBe(true);
      expect(toArray(step1.addedCapabilities!)).toEqual(["write"]);
      
      const step2 = checkEscalation(afterWrite, afterNetwork);
      expect(step2.isEscalation).toBe(true);
      expect(toArray(step2.addedCapabilities!)).toEqual(["network"]);
    });
  });
});
