/**
 * Capability calculus expressed as shared `Permission<T>` instances.
 *
 * Two systems live here because both reduce to set containment over `ExecutionCapability`:
 * - profile capability checks: may a command needing capabilities R run under a profile granting G?
 * - container enforcement verification: does what a runtime actually enforces stay within what
 *   the profile grants? This is the interface only; no runtime adapter exists yet, and an
 *   adapter must supply the observed set rather than this module probing for it.
 */
import {
  authorize,
  capabilities,
  checkEscalation,
  difference,
  isSubsetOf,
  toArray,
  union,
  type CapabilitySet,
} from "./capabilities";
import { allow, deny, type Permission } from "./permission";

/**
 * A profile's grant. `check` is `authorize`; `approve` escalates the grant and returns the
 * capabilities it actually added; `revoke` withdraws capabilities. The grant is held by the
 * instance so approval and revocation are observable to later checks.
 */
export interface ProfilePermission extends Permission<CapabilitySet, CapabilitySet, CapabilitySet, CapabilitySet> {
  readonly granted: CapabilitySet;
  approve(requested: CapabilitySet): CapabilitySet;
  revoke(capabilities: CapabilitySet): void;
}

export function profilePermission(initial: CapabilitySet): ProfilePermission {
  let granted = initial;
  return {
    system: "profile-capabilities",
    get granted() {
      return granted;
    },
    check(requested) {
      const result = authorize(requested, granted);
      return result.authorized ? allow(requested) : deny(result.reason ?? "Missing capabilities");
    },
    approve(requested) {
      const next = union(granted, requested);
      const escalation = checkEscalation(granted, next);
      granted = next;
      return escalation.addedCapabilities ?? capabilities([]);
    },
    revoke(capabilities) {
      granted = difference(granted, capabilities);
    },
  };
}

export interface ContainerEnforcementRequest {
  /** What the execution profile grants. */
  readonly profile: CapabilitySet;
  /** What the runtime adapter observed the container actually permitting. */
  readonly observed: CapabilitySet;
}

/**
 * Supplies what a container runtime really enforces. Deferred: no Docker/Podman adapter exists,
 * and until one does no session may treat enforcement as verified.
 */
export interface ContainerEnforcementProbe {
  observe(sessionId: string): Promise<CapabilitySet>;
}

/**
 * Verification passes only when observed enforcement is no wider than the profile. A runtime
 * that permits less than the profile grants is safe (and allowed); one that permits more is
 * a sandbox escape and is denied with the excess named.
 */
export const containerEnforcementPermission: Permission<ContainerEnforcementRequest, CapabilitySet> = {
  system: "container-enforcement",
  check({ profile, observed }) {
    if (isSubsetOf(observed, profile)) return allow(observed);
    return deny(`Runtime enforcement exceeds profile: ${toArray(difference(observed, profile)).join(", ")}`);
  },
};
