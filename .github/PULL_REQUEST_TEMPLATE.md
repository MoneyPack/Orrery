# Pull request

## What
One-paragraph summary. Link the spec/plan/issue if one exists.

## Trust-boundary impact
- [ ] No change to daemon, kernel, promotion, signing, IPC, or permissions
- [ ] Touches a trust boundary — ADR written or updated in `docs/superpowers/adrs/`

## Verification
Commands run + results (paste the green lines):

- [ ] `npm run typecheck`
- [ ] Focused tests: …
- [ ] `npm test -- --run`
- [ ] Smokes as relevant: `mission:smoke` / `daemon:smoke` / `desktop:smoke` / `test:e2e`

## Checklist
- [ ] Conventional commit message(s)
- [ ] No unsigned-artifact or security-check weakening
- [ ] Docs updated if behavior or policy changed
