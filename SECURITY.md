# Security Policy

## Supported versions

| Version | Status |
|---|---|
| 0.1.x (local-validation line) | Supported — report issues, get fixes |
| 0.0.0 placeholder, unsigned snapshots | Not supported — upgrade to 0.1.x |

Only signed tags cut from a green `release-gate` run count as releases. Unsigned local builds (`ORRERY_UNSIGNED_LOCAL=1`) are never a release and must never be distributed.

## Trust model in one paragraph

The authenticated loopback daemon is the sole authority for repository trust, execution, snapshots, ordered events, inspection, and promotion. Electron, OpenTUI, the browser renderer, and the Theia extension are untrusted clients of the same `MissionControlClient` contract — none receives Git, filesystem, process, or kernel primitives. Promotion additionally requires a single-use challenge/response over an inherited, non-reopenable stdio pipe; environment variables, protocol clients, TUI processes, and web content cannot register or replace the approval key. Full details: [`docs/superpowers/specs/2026-08-28-daemon-opentui-control-plane-design.md`](docs/superpowers/specs/2026-08-28-daemon-opentui-control-plane-design.md).

## Reporting a vulnerability

- **Do not open a public issue.** Email the maintainers or use GitHub's private "Report a vulnerability" button on the Security tab.
- Include: affected version/commit, threat (what an attacker gains), and a minimal reproduction if you have one.
- We will acknowledge within 5 business days, fix on a private branch, and credit you in the release notes unless you ask otherwise.

## What is out of scope

- Unsigned local-only builds (`ORRERY_UNSIGNED_LOCAL=1`) — distribution of these is already a policy violation, not a vulnerability.
- Arbitrary same-user native malware modifying same-user files — outside the boundary unless OS-backed code identity lands (see trust-model doc).
- Social engineering, physical access, or compromised developer machines.
