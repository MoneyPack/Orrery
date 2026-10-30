/**
 * Shared permission pattern.
 *
 * Every permission system in Orrery answers the same question — may this request proceed? —
 * and differs only in what a request is, what a successful check yields, and whether grants
 * can be minted or withdrawn at runtime. This module fixes that shape without fixing policy:
 *
 * - `check` is mandatory and returns a decision, never an exception. Denials carry a reason,
 *   so callers choose between failing closed with `enforce` and branching on the result.
 *   `check` need not be pure: single-use systems (tool approval) spend on allow, so a
 *   second identical check may deny where the first allowed.
 * - `approve` and `revoke` are optional, because some systems have no runtime grant (IPC sender
 *   trust is fixed by the window that loaded the renderer) and pretending otherwise would add
 *   an approval path that does not exist.
 * - `audit` is a wrapper, not a method, so recording a decision can never change it.
 *
 * Framework-free: no host-runtime, windowing, or DOM dependency. Crypto, files, and
 * clocks stay in the adapters that implement a permission.
 */

export interface PermissionAllowed<G> {
  readonly allowed: true;
  readonly grant: G;
}

export interface PermissionDenied {
  readonly allowed: false;
  readonly reason: string;
}

export type PermissionDecision<G = true> = PermissionAllowed<G> | PermissionDenied;

export function allow(): PermissionAllowed<true>;
export function allow<G>(grant: G): PermissionAllowed<G>;
export function allow<G>(...args: [] | [G]): PermissionAllowed<G | true> {
  return { allowed: true, grant: args.length === 0 ? true : args[0] };
}

export function deny(reason: string): PermissionDenied {
  return { allowed: false, reason };
}

/**
 * A permission system.
 *
 * @typeParam T - the request being checked.
 * @typeParam G - what an allowed check yields (verified approval, granted set, or `true`).
 * @typeParam A - what `approve` mints (a capability token, the capabilities added).
 * @typeParam H - what `revoke` withdraws (a nonce, a capability set).
 * @typeParam M - what `approve` takes. Defaults to `T`; differs for single-use tokens,
 *   where minting must not already require the token that `check` consumes.
 */
export interface Permission<T, G = true, A = never, H = never, M = T> {
  /** Stable name of the system, used in audit records. */
  readonly system: string;
  check(request: T): PermissionDecision<G>;
  approve?(request: M): A;
  revoke?(handle: H): void;
}

/** Fails closed: returns the grant or throws with the denial reason (or a fixed message). */
export function enforce<G>(decision: PermissionDecision<G>, toError: (reason: string) => Error = reason => new Error(reason)): G {
  if (!decision.allowed) throw toError(decision.reason);
  return decision.grant;
}

/** Combines checks in order; the first denial wins and later checks are not evaluated. */
export function allOf<T>(system: string, ...checks: ReadonlyArray<(request: T) => PermissionDecision<unknown>>): Permission<T> {
  return {
    system,
    check(request) {
      for (const check of checks) {
        const decision = check(request);
        if (!decision.allowed) return decision;
      }
      return allow();
    },
  };
}

export type PermissionAuditOutcome = "allowed" | "denied" | "approved" | "revoked";

export interface PermissionAuditRecord {
  readonly system: string;
  readonly outcome: PermissionAuditOutcome;
  /** Caller-supplied, redacted description of the subject. Never the raw request. */
  readonly subject: string;
  readonly reason?: string;
}

export type PermissionAuditSink = (record: PermissionAuditRecord) => void;

/**
 * Wraps a permission so every check, approval, and revocation is reported to `sink`.
 *
 * The decision is returned unchanged; `describe` must redact anything secret (capability
 * tokens, arguments) because audit records are meant to be persisted. A throwing sink is
 * isolated so auditing can never turn an allow into a failure or a deny into an allow.
 * When `approve` takes a different shape than `check`, pass `describeApproval` for it.
 */
export function audited<T, G, A, H>(
  permission: Permission<T, G, A, H>,
  sink: PermissionAuditSink,
  describe?: (request: T) => string,
  describeHandle?: (handle: H) => string,
): Permission<T, G, A, H>;
export function audited<T, G, A, H, M>(
  permission: Permission<T, G, A, H, M>,
  sink: PermissionAuditSink,
  describe: (request: T) => string,
  describeHandle: (handle: H) => string,
  describeApproval: (request: M) => string,
): Permission<T, G, A, H, M>;
export function audited<T, G, A, H, M>(
  permission: Permission<T, G, A, H, M>,
  sink: PermissionAuditSink,
  describe: (request: T) => string = () => "",
  describeHandle: (handle: H) => string = () => "",
  describeApproval: (request: M) => string = describe as unknown as (request: M) => string,
): Permission<T, G, A, H, M> {
  const emit = (record: PermissionAuditRecord): void => {
    try {
      sink(record);
    } catch {
      // An audit failure must not alter the decision it records.
    }
  };
  const wrapped: Permission<T, G, A, H, M> = {
    system: permission.system,
    check(request) {
      const decision = permission.check(request);
      emit(decision.allowed
        ? { system: permission.system, outcome: "allowed", subject: describe(request) }
        : { system: permission.system, outcome: "denied", subject: describe(request), reason: decision.reason });
      return decision;
    },
  };
  if (permission.approve) {
    const approve = permission.approve.bind(permission);
    wrapped.approve = (request) => {
      const approval = approve(request);
      emit({ system: permission.system, outcome: "approved", subject: describeApproval(request) });
      return approval;
    };
  }
  if (permission.revoke) {
    const revoke = permission.revoke.bind(permission);
    wrapped.revoke = (handle) => {
      revoke(handle);
      emit({ system: permission.system, outcome: "revoked", subject: describeHandle(handle) });
    };
  }
  return wrapped;
}
