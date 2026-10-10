# Architecture Decision Record: Capability Calculus

**Date**: 2026-10-09  
**Status**: Accepted  
**Context**: Agent Execution Sessions

## Decision

Extract a standalone capability algebra as the single source of truth for execution authorization, profile validation, and runtime verification.

## Context

The agent-execution sessions design introduces multiple overlapping capability concerns:
- Profile-defined capability grants
- Command-derived capability requirements  
- Runtime enforcement verification
- Escalation detection across session lifecycle

Without a unified model, these would diverge into inconsistent permission checks scattered across daemon, protocol, and UI layers.

## Decision

Implement `packages/mission-control-domain/src/capabilities.ts` providing:

1. **Type-safe capability sets** backed by immutable `ReadonlySet<ExecutionCapability>`
2. **Set algebra**: union, intersection, difference, subset, equality
3. **Derivation**: compute capabilities from command characteristics
4. **Authorization**: check if requested ⊆ granted, report missing
5. **Delegation**: create attenuated capability subsets
6. **Revocation**: remove capabilities from a set
7. **Escalation detection**: identify added capabilities between versions
8. **High-risk classification**: explicit list of capabilities requiring approval

## Consequences

### Positive

- **Single source of truth**: All capability logic references this module
- **Composable**: Operations compose cleanly (delegate ∘ revoke ∘ union)
- **Testable**: Pure functions with no I/O or state
- **Auditable**: Authorization decisions have traceable inputs/outputs
- **Future-proof**: Supports secrets, mounts, persistent shells without changing the algebra

### Negative

- **Abstraction cost**: Simple "does this profile allow destructive?" becomes a set operation
- **Learning curve**: Contributors must understand set-theoretic operations

### Mitigations

- Comprehensive test suite with 42 test cases covering common scenarios
- Documentation includes concrete usage examples
- Helper functions (`containsHighRisk`, `deriveCapabilities`) hide complexity for common cases

## Implementation Notes

The module is:
- Framework-free (lives in `mission-control-domain`)
- Zero dependencies beyond TypeScript stdlib
- Fully covered by property-based scenarios
- Serializable to JSON via `toArray`/`fromArray`

Future work:
- Add non-delegatable capability markers (e.g., `privileged` cannot be delegated)
- Support time-bounded capabilities (expires after N seconds)
- Add capability provenance tracking (who granted this capability?)

## Alternatives Considered

1. **Boolean flags per capability**: Simple but doesn't compose, can't detect escalation
2. **String arrays**: No type safety, easy to have capability name typos
3. **Bitflags**: Fast but not human-readable, hard to extend beyond 32/64 capabilities
4. **Object-capability tokens**: Powerful but requires runtime enforcement, not serializable

## Related Decisions

- Blocks implementation of Profile Revision schema (needs capability validation)
- Blocks Command Authorization (needs capability derivation + authorization)
- Blocks Session Authority (needs delegation + revocation)
- Enables structured logging of authorization failures with exact missing capabilities
