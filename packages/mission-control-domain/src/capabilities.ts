/**
 * Capability Calculus
 * 
 * A standalone capability algebra for execution profiles, command authorization,
 * and runtime verification. Provides union, intersection, delegation, and revocation
 * operations over capability sets.
 * 
 * This is the single source of truth for:
 * - Profile capability validation
 * - Command authorization checks
 * - Runtime enforcement verification
 * - Capability escalation logic
 */

export type ExecutionCapability =
  | "read"
  | "write"
  | "destructive"
  | "network"
  | "spend"
  | "secret"
  | "privileged";

export interface CapabilitySet {
  readonly capabilities: ReadonlySet<ExecutionCapability>;
}

/**
 * Create a capability set from an array of capabilities.
 */
export function capabilities(caps: ExecutionCapability[]): CapabilitySet {
  return { capabilities: new Set(caps) };
}

/**
 * Union: combine two capability sets (A ∪ B).
 */
export function union(a: CapabilitySet, b: CapabilitySet): CapabilitySet {
  return {
    capabilities: new Set([...a.capabilities, ...b.capabilities]),
  };
}

/**
 * Intersection: capabilities present in both sets (A ∩ B).
 */
export function intersection(a: CapabilitySet, b: CapabilitySet): CapabilitySet {
  return {
    capabilities: new Set(
      [...a.capabilities].filter((cap) => b.capabilities.has(cap))
    ),
  };
}

/**
 * Difference: capabilities in A but not in B (A \ B).
 */
export function difference(a: CapabilitySet, b: CapabilitySet): CapabilitySet {
  return {
    capabilities: new Set(
      [...a.capabilities].filter((cap) => !b.capabilities.has(cap))
    ),
  };
}

/**
 * Check if set A is a subset of set B (A ⊆ B).
 * Returns true if every capability in A is also in B.
 */
export function isSubsetOf(a: CapabilitySet, b: CapabilitySet): boolean {
  return [...a.capabilities].every((cap) => b.capabilities.has(cap));
}

/**
 * Check if two capability sets are equal.
 */
export function equals(a: CapabilitySet, b: CapabilitySet): boolean {
  return isSubsetOf(a, b) && isSubsetOf(b, a);
}

/**
 * Check if a capability set is empty.
 */
export function isEmpty(set: CapabilitySet): boolean {
  return set.capabilities.size === 0;
}

/**
 * Derive capabilities from a command's characteristics.
 * This is where domain knowledge about what operations require which capabilities lives.
 */
export function deriveCapabilities(characteristics: {
  modifiesFiles?: boolean;
  deletesFiles?: boolean;
  requiresNetwork?: boolean;
  accessesSecrets?: boolean;
  spendsMoney?: boolean;
  requiresPrivileged?: boolean;
}): CapabilitySet {
  const caps: ExecutionCapability[] = [];

  if (characteristics.modifiesFiles) caps.push("write");
  if (characteristics.deletesFiles) caps.push("destructive");
  if (characteristics.requiresNetwork) caps.push("network");
  if (characteristics.accessesSecrets) caps.push("secret");
  if (characteristics.spendsMoney) caps.push("spend");
  if (characteristics.requiresPrivileged) caps.push("privileged");

  // Read is implicit for any file access
  if (characteristics.modifiesFiles || characteristics.deletesFiles) {
    caps.push("read");
  }

  return capabilities(caps);
}

/**
 * Authorization decision: can the requested capabilities be satisfied by the granted capabilities?
 */
export interface AuthorizationResult {
  authorized: boolean;
  missing?: CapabilitySet;
  reason?: string;
}

export function authorize(
  requested: CapabilitySet,
  granted: CapabilitySet
): AuthorizationResult {
  if (isSubsetOf(requested, granted)) {
    return { authorized: true };
  }

  const missing = difference(requested, granted);
  return {
    authorized: false,
    missing,
    reason: `Missing capabilities: ${[...missing.capabilities].join(", ")}`,
  };
}

/**
 * Delegation: create a subset of capabilities that can be delegated.
 * Some capabilities may not be delegatable in your security model.
 */
export function delegate(
  source: CapabilitySet,
  requested: CapabilitySet
): CapabilitySet {
  // For now, all capabilities can be delegated if they're present in source
  // Future: add non-delegatable capability logic here
  return intersection(source, requested);
}

/**
 * Revocation: remove capabilities from a set.
 */
export function revoke(
  from: CapabilitySet,
  toRevoke: CapabilitySet
): CapabilitySet {
  return difference(from, toRevoke);
}

/**
 * Escalation check: does the new set escalate beyond the old set?
 */
export interface EscalationCheck {
  isEscalation: boolean;
  addedCapabilities?: CapabilitySet;
}

export function checkEscalation(
  oldSet: CapabilitySet,
  newSet: CapabilitySet
): EscalationCheck {
  const added = difference(newSet, oldSet);
  return {
    isEscalation: !isEmpty(added),
    addedCapabilities: isEmpty(added) ? undefined : added,
  };
}

/**
 * Serialize capabilities to a stable string array for storage/comparison.
 */
export function toArray(set: CapabilitySet): ExecutionCapability[] {
  return [...set.capabilities].sort();
}

/**
 * Parse capabilities from a stored array.
 */
export function fromArray(caps: ExecutionCapability[]): CapabilitySet {
  return capabilities(caps);
}

/**
 * High-risk capabilities that always require explicit approval.
 */
export const HIGH_RISK_CAPABILITIES = capabilities([
  "destructive",
  "network",
  "spend",
  "secret",
  "privileged",
]);

/**
 * Check if a capability set contains any high-risk capabilities.
 */
export function containsHighRisk(set: CapabilitySet): boolean {
  return !isEmpty(intersection(set, HIGH_RISK_CAPABILITIES));
}
