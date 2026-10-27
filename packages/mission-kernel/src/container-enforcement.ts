/**
 * Container enforcement contract (first slice, local-only).
 *
 * Framework-free: this module inspects no runtime, spawns no process, and touches no
 * filesystem. It answers one question over an already-obtained `docker inspect`-like
 * value — may a session be dispatched into this container? Every check fails closed:
 * a missing, mistyped, or unexpected field denies dispatch with a named reason.
 *
 * Relationship to Task 7: `ContainerEnforcementProbe` in
 * `@orrery/mission-control-domain` compares capability sets (observed enforcement must
 * be a subset of the profile grant). This contract is the layer beneath it — it derives
 * the allow/deny verdict from the raw inspect matrix in
 * `docs/superpowers/specs/2026-09-06-agent-execution-sessions-design.md` section 8
 * (privileged, network, mounts, user, capabilities, no-new-privileges, seccomp,
 * read-only root, tmpfs, namespaces, image digest) before any adapter reports an
 * observed capability set. It extends that probe; it does not duplicate it.
 *
 * What remains (explicitly out of scope here): the real Docker/Podman CLI adapters
 * that obtain inspect output, `SessionAuthority` dispatch wiring, and any native
 * fallback. No session may be labeled `ENFORCED` until an adapter supplies genuine
 * inspect output through this contract.
 */

export interface ContainerEnforcementPolicy {
  /** Fixed in-container destination of the mission worktree (for example "/workspace"). */
  readonly workspaceDestination: string;
  /** Host path prefixes permitted as bind/mount sources (worktree plus the inert overlay). */
  readonly allowedBindSources: readonly string[];
  /** Optional pinned image digest (for example "sha256:…"); when set the image must match. */
  readonly allowedImageDigest?: string;
}

export interface ContainerInspectRequest {
  /** Parsed `docker inspect`-like value: one container object or a single-element array. */
  readonly inspect: unknown;
  readonly policy: ContainerEnforcementPolicy;
}

export type ContainerEnforcementVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasons: readonly string[] };

export interface ContainerEnforcement {
  readonly system: "container-enforcement";
  verify(request: ContainerInspectRequest): ContainerEnforcementVerdict;
  verifyJsonText(text: unknown, policy: ContainerEnforcementPolicy): ContainerEnforcementVerdict;
}

const MAX_INSPECT_BYTES = 1_000_000;
const ROOT_USERS = new Set(["", "0", "root"]);
const SOCKET_SUFFIXES = ["docker.sock", "podman.sock", "containerd.sock", "crio.sock"];
const FORBIDDEN_SOURCE_PREFIXES = ["/", "/etc", "/proc", "/sys", "/run", "/var/run"];
const NAMESPACE_MODE_FIELDS = ["PidMode", "IpcMode", "UTSMode", "UsernsMode", "CgroupnsMode"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function denied(reason: string): ContainerEnforcementVerdict {
  return { allowed: false, reasons: [reason] };
}

function validPolicy(policy: ContainerEnforcementPolicy): string | null {
  if (!isRecord(policy)) return "enforcement policy must be an object";
  if (typeof policy.workspaceDestination !== "string" || !policy.workspaceDestination.startsWith("/")) {
    return "enforcement policy has an invalid workspace destination";
  }
  if (
    !Array.isArray(policy.allowedBindSources) ||
    policy.allowedBindSources.length === 0 ||
    policy.allowedBindSources.some((source) => typeof source !== "string" || !source)
  ) {
    return "enforcement policy has no allowed bind sources";
  }
  if (policy.allowedImageDigest !== undefined && typeof policy.allowedImageDigest !== "string") {
    return "enforcement policy has an invalid image digest pin";
  }
  return null;
}

function sourceWithinAllowed(source: string, allowed: readonly string[]): boolean {
  const normalized = normalizePath(source);
  return allowed.some((prefix) => {
    const normalizedPrefix = normalizePath(prefix).replace(/\/$/, "");
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
}

function forbiddenSourceReason(source: string): string | null {
  const normalized = normalizePath(source).toLowerCase().replace(/\/$/, "");
  for (const socket of SOCKET_SUFFIXES) {
    if (normalized === socket || normalized.endsWith(`/${socket}`)) {
      return `container socket mount is forbidden: ${source}`;
    }
  }
  for (const prefix of FORBIDDEN_SOURCE_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return `host system mount is forbidden: ${source}`;
    }
  }
  return null;
}

function parseBind(bind: string): { source: string; destination: string; options: string[] } | null {
  const parts = bind.split(":");
  if (parts.length < 2) return null;
  let source: string;
  let rest: string[];
  if (parts.length > 2 && /^[A-Za-z]$/.test(parts[0] ?? "")) {
    source = `${parts[0]}:${parts[1]}`;
    rest = parts.slice(2);
  } else {
    source = parts[0] ?? "";
    rest = parts.slice(1);
  }
  const [destination, ...options] = rest;
  if (!source || !destination) return null;
  return { source, destination, options };
}

function checkBinds(
  binds: unknown,
  policy: ContainerEnforcementPolicy,
  reasons: string[],
  seen: { worktree: boolean; gitOverlay: boolean; gitOverlayReadOnly: boolean },
): void {
  if (binds === undefined || binds === null) return;
  if (!Array.isArray(binds)) {
    reasons.push("HostConfig.Binds must be an array");
    return;
  }
  for (const bind of binds) {
    if (typeof bind !== "string") {
      reasons.push("HostConfig.Binds entries must be strings");
      continue;
    }
    const parsed = parseBind(bind);
    if (!parsed) {
      reasons.push(`unparseable bind entry: ${bind}`);
      continue;
    }
    checkMountSource(parsed.source, reasons);
    checkMountDestination(parsed, policy, reasons, seen);
    if (
      normalizePath(parsed.destination) === `${policy.workspaceDestination}/.git` &&
      !parsed.options.some((option) => option.toLowerCase() === "ro")
    ) {
      seen.gitOverlayReadOnly = false;
      reasons.push(`inert .git overlay must be read-only: ${bind}`);
    }
  }
}

function checkMountSource(source: unknown, reasons: string[]): void {
  if (typeof source !== "string" || !source) {
    reasons.push("mount source must be a nonempty string");
    return;
  }
  const forbidden = forbiddenSourceReason(source);
  if (forbidden) reasons.push(forbidden);
}

function checkMountDestination(
  mount: { source: string; destination: string },
  policy: ContainerEnforcementPolicy,
  reasons: string[],
  seen: { worktree: boolean; gitOverlay: boolean; gitOverlayReadOnly: boolean },
): void {
  if (typeof mount.destination !== "string" || !mount.destination) {
    reasons.push("mount destination must be a nonempty string");
    return;
  }
  const destination = normalizePath(mount.destination);
  if (destination === policy.workspaceDestination) {
    seen.worktree = true;
  } else if (destination === `${policy.workspaceDestination}/.git`) {
    seen.gitOverlay = true;
  } else {
    reasons.push(`extra mount destination is forbidden: ${mount.destination}`);
    return;
  }
  if (!sourceWithinAllowed(mount.source, policy.allowedBindSources)) {
    reasons.push(`mount source is outside the allowed worktree: ${mount.source}`);
  }
}

function checkMounts(
  mounts: unknown,
  policy: ContainerEnforcementPolicy,
  reasons: string[],
  seen: { worktree: boolean; gitOverlay: boolean; gitOverlayReadOnly: boolean },
): void {
  if (mounts === undefined || mounts === null) return;
  if (!Array.isArray(mounts)) {
    reasons.push("Mounts must be an array");
    return;
  }
  for (const mount of mounts) {
    if (!isRecord(mount)) {
      reasons.push("Mounts entries must be objects");
      continue;
    }
    checkMountSource(mount.Source, reasons);
    if (!isRecord(mount) || typeof mount.Destination !== "string") {
      reasons.push("mount destination must be a nonempty string");
      continue;
    }
    checkMountDestination(
      { source: typeof mount.Source === "string" ? mount.Source : "", destination: mount.Destination },
      policy,
      reasons,
      seen,
    );
    if (
      normalizePath(mount.Destination) === `${policy.workspaceDestination}/.git` &&
      mount.RW !== false
    ) {
      seen.gitOverlayReadOnly = false;
      reasons.push("inert .git overlay must be read-only");
    }
  }
}

function checkSecurityOpt(securityOpt: unknown, reasons: string[]): void {
  if (!Array.isArray(securityOpt)) {
    reasons.push("HostConfig.SecurityOpt is missing");
    return;
  }
  const entries = securityOpt.filter((entry): entry is string => typeof entry === "string");
  if (entries.length !== securityOpt.length) {
    reasons.push("HostConfig.SecurityOpt entries must be strings");
  }
  const normalized = entries.map((entry) => entry.toLowerCase());
  if (!normalized.some((entry) => entry === "no-new-privileges" || entry.startsWith("no-new-privileges:"))) {
    reasons.push("no-new-privileges is missing");
  }
  const seccomp = normalized.find((entry) => entry.startsWith("seccomp="));
  if (!seccomp) {
    reasons.push("seccomp confinement is missing");
  } else if (seccomp === "seccomp=unconfined") {
    reasons.push("seccomp=unconfined is forbidden");
  }
}

function verifyContainer(container: unknown, policy: ContainerEnforcementPolicy): string[] {
  const reasons: string[] = [];
  if (!isRecord(container)) return ["inspected container must be an object"];
  const hostConfig = container.HostConfig;
  if (!isRecord(hostConfig)) return ["HostConfig is missing"];

  if (hostConfig.Privileged !== false) reasons.push("Privileged must be false");
  if (hostConfig.NetworkMode !== "none") reasons.push("NetworkMode must be none");
  if (hostConfig.ReadonlyRootfs !== true) reasons.push("ReadonlyRootfs must be true");

  if (hostConfig.CapAdd !== undefined && hostConfig.CapAdd !== null) {
    if (!Array.isArray(hostConfig.CapAdd)) {
      reasons.push("HostConfig.CapAdd must be an array");
    } else if (hostConfig.CapAdd.length > 0) {
      reasons.push(`added Linux capabilities are forbidden: ${hostConfig.CapAdd.join(", ")}`);
    }
  }
  if (
    !Array.isArray(hostConfig.CapDrop) ||
    !hostConfig.CapDrop.some((entry) => typeof entry === "string" && entry.toLowerCase() === "all")
  ) {
    reasons.push("CapDrop must include ALL");
  }

  for (const field of ["Devices", "DeviceRequests"] as const) {
    const devices = hostConfig[field];
    if (devices !== undefined && devices !== null) {
      if (!Array.isArray(devices)) reasons.push(`HostConfig.${field} must be an array`);
      else if (devices.length > 0) reasons.push(`container devices are forbidden (${field})`);
    }
  }

  checkSecurityOpt(hostConfig.SecurityOpt, reasons);

  for (const field of NAMESPACE_MODE_FIELDS) {
    const mode = hostConfig[field];
    if (typeof mode === "string" && mode.toLowerCase() === "host") {
      reasons.push(`${field} must not join the host namespace`);
    }
  }

  const tmpfs = hostConfig.Tmpfs;
  if (!isRecord(tmpfs) || !("/tmp" in tmpfs)) {
    reasons.push("a bounded /tmp filesystem is required");
  }

  const config = container.Config;
  if (!isRecord(config)) {
    reasons.push("Config is missing");
  } else {
    const user = config.User;
    const primary = typeof user === "string" ? user.split(":")[0]?.trim().toLowerCase() ?? "" : "";
    if (typeof user !== "string" || ROOT_USERS.has(primary)) {
      reasons.push("container user must be a non-root user");
    }
    if (policy.allowedImageDigest !== undefined) {
      const image = config.Image;
      if (
        typeof image !== "string" ||
        (image !== policy.allowedImageDigest && !image.endsWith(`@${policy.allowedImageDigest}`))
      ) {
        reasons.push("image digest does not match the approved digest");
      }
    }
  }

  const seen = { worktree: false, gitOverlay: false, gitOverlayReadOnly: true };
  checkBinds(hostConfig.Binds, policy, reasons, seen);
  checkMounts(container.Mounts, policy, reasons, seen);
  if (!seen.worktree) reasons.push("mission worktree destination is not mounted");
  if (!seen.gitOverlay) reasons.push("inert .git overlay is missing");

  return reasons;
}

export function verifyContainerEnforcement(request: ContainerInspectRequest): ContainerEnforcementVerdict {
  const policyError = validPolicy(request.policy);
  if (policyError) return denied(policyError);
  const inspect = request.inspect;
  const container = Array.isArray(inspect)
    ? inspect.length === 1
      ? inspect[0]
      : undefined
    : inspect;
  if (container === undefined) return denied("inspect output must be a single inspected container");
  const reasons = verifyContainer(container, request.policy);
  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}

export function verifyContainerInspectJsonText(
  text: unknown,
  policy: ContainerEnforcementPolicy,
): ContainerEnforcementVerdict {
  if (typeof text !== "string") return denied("inspect output must be JSON text");
  if (text.length > MAX_INSPECT_BYTES) return denied(`inspect output exceeds ${MAX_INSPECT_BYTES} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return denied("inspect output is not valid JSON");
  }
  return verifyContainerEnforcement({ inspect: parsed, policy });
}

export function createContainerEnforcement(): ContainerEnforcement {
  return {
    system: "container-enforcement",
    verify: (request) => verifyContainerEnforcement(request),
    verifyJsonText: (text, policy) => verifyContainerInspectJsonText(text, policy),
  };
}
