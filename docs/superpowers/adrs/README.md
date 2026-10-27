# Architecture Decision Log

Short process plus the index of accepted records. New decisions start as `Proposed` and become `Accepted` when their implementation lands and passes review.

## When to write an ADR

- A trust boundary moves (what runs where, who may call whom).
- A security decision trades strictness for usability or vice versa.
- A data format or protocol gains a versioning or compatibility promise.
- An infrastructure choice constrains future work (pins, native deps, hosting).

One decision per file. Specs say what we build, plans say how, ADRs say why.

## How to propose, accept, supersede

1. Copy `TEMPLATE.md` to `YYYY-MM-DD-<slug>.md`, status `Proposed`.
2. Link the motivating spec or plan under Context.
3. `Accepted` when the implementation merges and its review passes.
4. Never edit an accepted ADR in place — write a new one with status `Accepted` and mark the old one `Superseded by <new file>`.

## Index

| Date | Record | Status |
|------|--------|--------|
| 2026-10-09 | [Capability Calculus](2026-10-09-capability-calculus.md) | Accepted |
| 2026-10-09 | [Mission Replay Debugger](2026-10-09-mission-replay-debugger.md) | Accepted |
| 2026-10-27 | [SSH Transport Design](2026-10-27-ssh-transport-design.md) | Proposed |
| 2026-10-27 | [Trust-Boundary Mapping](2026-10-27-trust-boundary-mapping.md) | Accepted |
