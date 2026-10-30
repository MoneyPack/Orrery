# SSH Transport Design (Deferred Implementation)

Date: 2026-10-27
Status: Design only — no implementation, no protocol change.

## 1. Purpose

This document designs how a future remote operator could reach their own
Orrery daemon over SSH without changing the daemon's security posture.
It covers remote discovery, trust establishment, Git auth placement inside
containers, and network isolation impact on the daemon.

It implements nothing. It changes no protocol message, no validator, and no
code. The `mission-control.v1` and `agent-execution.v1` wire contracts stay
exactly as specified, so a later implementation only adds a transport adapter
— never a new message shape.

## 2. Background And Constraints

- The control-plane design
  (`docs/superpowers/specs/2026-08-28-daemon-opentui-control-plane-design.md`)
  defines the daemon as a single-user local control plane: it binds only to
  numeric loopback (`127.0.0.1` or `::1`) on an ephemeral port, publishes
  endpoint metadata without the raw token, and authenticates every connection
  with a daemon-generated capability token verified in constant time.
- The agent-execution design
  (`docs/superpowers/specs/2026-09-06-agent-execution-sessions-design.md`)
  keeps the daemon as the sole owner of containers, authorization,
  sequencing, transcripts, and cleanup. First-slice enforcement requires a
  **local** Docker/Podman engine: remote contexts, SSH contexts, and
  Kubernetes contexts are explicitly unsupported, sessions without a fully
  verified enforcement matrix are `unsupported` (never policy-only), and the
  container sees the mission worktree at `/workspace` with Git control
  metadata masked — Git operations stay daemon-owned.
- The control-plane design already reserves this direction: protocol message
  types are transport-neutral "so a later authenticated SSH adapter can reuse
  them."

## 3. Threat Model: What SSH Adds

The loopback daemon trusts the local user session: loopback reachability is
necessary but not sufficient, and the private runtime directory plus
capability token complete authentication. SSH extends that trust boundary
across a network, which adds threats the current design never faces:

- **Eavesdropping and tampering on the wire.** Loopback traffic never leaves
  the host. Remote traffic crosses networks the operator does not control,
  so confidentiality and integrity must come from the SSH channel itself —
  never from new daemon-side encryption or new protocol fields.
- **Impersonation of the remote endpoint.** A local client reads the token
  from a user-private file; a remote client cannot. Trust must be
  established by authenticating the SSH server (host-key verification) and
  authenticating the operator to that server (key-based auth), before the
  existing daemon token check ever runs. The token check remains the second,
  unchanged factor — it is not replaced or weakened.
- **Token exposure.** The capability token must never travel over an
  unauthenticated channel and must never be stored on the remote client in a
  weaker location than the local private token file. Preferred: forward the
  already-authenticated byte stream (see Section 5), so the token is used
  only by a local process on the daemon host.
- **Endpoint-metadata spoofing.** Endpoint metadata (host, port, version,
  token path, PID, instance ID) is currently read from the local runtime
  directory. A remote client must obtain the equivalent facts through the
  authenticated SSH session — never from an unauthenticated discovery
  service, broadcast, or guessed port.
- **Multi-user and relay risk.** The daemon assumes one local user session.
  Remote access must not turn it into a shared network service: one SSH
  identity maps to the one owning user, and the daemon never listens on a
  new interface to serve remote clients directly (see Section 4).
- **Credential scope creep.** Git credentials, registry credentials, and
  approval-signer keys (see Sections 6–7) must not gain new transit paths
  just because the operator is remote.

What SSH does **not** change: the daemon's parser still treats all input as
untrusted, message-shape and ordering validation still apply, and the
renderer/model still receive only opaque handles and sanitized DTOs.

## 4. Loopback Binding Stays Unchanged

The daemon keeps binding only to numeric loopback on an ephemeral port.
This decision is load-bearing, not incidental:

- **Why it stays.** The entire local trust model — private runtime
  directory, endpoint lifecycle, startup lock, companion-daemon convergence,
  and the "loopback is necessary but not sufficient" rule — assumes the
  socket is unreachable from the network. Binding a LAN or wildcard address
  would convert a single-user control plane into a network service and force
  a redesign of authentication, parser hardening, and rate limiting. This
  design explicitly refuses that trade.
- **How remote access works instead.** The operator opens an SSH connection
  to the daemon host with local port forwarding (e.g.
  `ssh -L <local-port>:127.0.0.1:<daemon-port> <host>`), or the equivalent
  in the future client. The remote client then speaks the unmodified
  protocol to its own loopback endpoint, which SSH tunnels to the daemon's
  loopback socket. The daemon observes an ordinary loopback connection and
  applies its existing token check unchanged.
- **Consequences.** Discovery reduces to: (a) authenticate to the host over
  SSH, (b) learn the daemon's loopback port from the host's runtime
  directory through that authenticated session, (c) forward it. No new
  daemon listener, no new port registry, no firewall rule, no mDNS, no
  relay server. If SSH is unavailable, there is no remote path — that is the
  intended failure mode.

## 5. Remote Discovery And Trust Establishment

Discovery must reuse the existing endpoint lifecycle, not invent a parallel
one:

1. **Host authentication first.** The operator authenticates to the daemon
   host via SSH with key-based auth. Host keys are verified through the
   operator's existing known-hosts practice (TOFU on first connect with an
   explicit fingerprint check, or a provisioned host key). Password-only SSH
   auth is discouraged for the same reason the token file relies on OS
   file permissions: weak secrets in a strong frame.
2. **Endpoint lookup through the session.** Once authenticated, the client
   reads the daemon's published endpoint metadata from the host runtime
   directory over the SSH session (e.g. `ssh <host> cat <runtime-dir>/…`
   or an SFTP read). The metadata format is unchanged — it still carries
   no raw token.
3. **Port forwarding, then normal hello.** The client establishes local
   forwarding to the published loopback port and performs the standard
   `hello` authentication with the capability token. Token delivery to the
   remote machine is an operator decision with explicit trade-offs:
   - *Preferred:* keep the token on the daemon host by running the
     protocol client there (e.g. the TUI over `ssh -t`, or a forwarded
     local socket) so the token never crosses the network.
   - *Accepted with care:* copy the token over the authenticated SSH
     channel into a remote file with the same user-private permissions as
     the local token file, and treat that copy as equally sensitive.
   - *Rejected:* embedding the token in URLs, shell history, environment
     passed to untrusted processes, or any unauthenticated channel.
4. **No protocol change.** Trust establishment happens entirely below the
   protocol: SSH owns host/operator authentication and channel security;
   the daemon owns connection authentication exactly as today. A future
   `mission-control.v2` is not required and not desired for this.

## 6. Git Auth Placement: Inside Containers, Never The Renderer

The agent-execution design fixes the hard boundary: containers receive the
mission worktree with Git control metadata masked, Git operations are
daemon-owned, and registry/Git authentication "is not sent to the model or
stored in profile records." Remote access does not move that line:

- **Git auth material lives in the daemon.** Credentials used for fetch,
  push, promotion, or image pulls are held in daemon-private state (or the
  host OS credential store via a daemon-side adapter, per the deferred
  secrets design) and used by daemon-owned Git operations only.
- **Never the renderer.** The remote TUI, browser, or any renderer process
  receives the same sanitized DTOs as the local client: opaque session and
  evidence IDs, bounded transcript text, digests. It never receives Git
  credential values, credential-file paths, or anything it could mistake
  for usable auth material — even though the operator is now remote and it
  might seem convenient.
- **Never the container beyond the existing mask.** Containers keep seeing
  `/workspace` with the inert `.git` overlay and no common-Git-directory
  or target-checkout mounts. If a future slice needs Git *inside* a
  container (e.g. an agent-authored commit), the credential must be injected
  by the daemon through the narrow per-command secret-scoping mechanism of
  the deferred secrets design — short-lived, operation-scoped, and
  redacted from transcripts — not by baking auth into the image or
  widening the mount.
- **SSH agent forwarding is out of scope.** Forwarding the operator's SSH
  agent into containers or across the remote hop would give container
  processes (and anything that compromises them) the operator's Git/SSH
  identity. If ever proposed, it needs its own threat-model addendum; this
  design does not approve it.

## 7. Network Isolation Impact On The Daemon

Remote operator access and container network isolation are orthogonal by
construction:

- **Container `network: none` is unaffected.** The enforcement matrix
  already requires network mode `none` and rejects any profile requesting
  network capability in the first slice. The operator's packets arriving
  over SSH terminate at the daemon's loopback socket; they do not create a
  network path into any container. The adapter's post-creation inspection
  (no extra mounts, network still `none`, config matches request) runs
  identically whether the human approved from the next desk or another
  continent.
- **The daemon gains no new egress.** Remote discovery (Section 5) is
  inbound SSH to the host plus local reads. The daemon itself opens no
  outbound connections, contacts no relay, and phones nothing home. Image
  pulls and registry auth remain host/operator-runtime concerns as today.
- **Approval flow over distance.** Command approvals still require the
  pinned live Electron signer and trusted native-window flow; the daemon
  token alone still cannot approve. A remote operator approves through
  their own trusted local Electron instance talking to their daemon — or,
  if operator and daemon are on different machines, the approval-signer
  bootstrap (ephemeral Ed25519 keypair pinned via the parent-bootstrap
  handoff) must be re-examined: the private key must remain in the
  Electron main memory of the machine the operator physically trusts, and
  the handoff channel must itself run inside the authenticated SSH session.
  The exact mechanism is deferred to implementation; the invariant is not:
  **no approval without the pinned live signer, regardless of distance.**
- **Engine locality rule stands.** The enforcement matrix rejects remote
  engine contexts and SSH contexts. The daemon's engine endpoint must
  remain local to the daemon host — the operator may be remote, but the
  daemon-to-engine path never is.

## 8. Extension Compatibility

The daemon protocol stays extension-compatible by staying untouched:

- No new message types, no new fields, no changed validation in
  `mission-control.v1` or `agent-execution.v1`.
- A future SSH adapter is a transport under the existing messages: it
  delivers the same bytes the loopback socket would carry, after SSH has
  handled authentication and confidentiality.
- Capability discovery, intent IDs, sequence expectations, opaque IDs, and
  bounded inputs all behave identically; tests pinning the protocol need no
  SSH-aware variants.
- If a future protocol version ever needs remote-specific semantics, it
  follows the existing rule: a new version identifier, never a silent
  change to v1 shapes.

## 9. Explicit Non-Goals

- **No implementation.** No SSH client, server, forwarder, key manager, or
  config flag is added by this document.
- **No protocol change.** No new namespace, message, field, or version.
- **No new daemon listener.** The daemon never binds non-loopback
  addresses; there is no "remote mode."
- **No discovery service.** No broadcast, registry, relay, or
  unauthenticated endpoint publication.
- **No weakened isolation.** No network-enabled containers, remote engine
  contexts, SSH-agent forwarding into containers, or Git auth in the
  renderer justified by remote convenience.
- **No approval bypass.** Distance never substitutes for the pinned live
  Electron signer flow.
- **No multi-user daemon.** One SSH identity maps to the one owning user;
  shared-team access is a separate design with its own trust model.
