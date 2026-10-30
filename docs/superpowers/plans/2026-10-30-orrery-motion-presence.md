# 2026-10-30 ORRERY Motion + Presence Overhaul

## Design Read
- Reading this as: mission-control desktop shell for technical operators, industrial-editorial keeper elevated to premium, native CSS + React hooks.

## Dials
- VARIANCE 8 / MOTION 6 / DENSITY 4

## Goals
- Keep tokens, hairlines, amber accent, Phosphor-only icons.
- Native motion only: `[data-reveal]` / `[data-stagger]`, `.meter`, `.beacon`, `[data-tick]`.
- Respect `prefers-reduced-motion`, forced-colors, axe + e2e selectors.

## Motion Pass (native, no libs)
- **Launch**: headline mask rise, aurora drift, emblem glow, pillars stagger, enter shine sweep, count-up tick.
- **Shell entry**: command-bar + workbench cascade via `data-entered`.
- **Sidebar**: row slide-in cascade, hover nudge, active amber wash + bar.
- **Lifecycle**: done rail fill, current node-pop + beacon ring, danger/success tones.
- **Timeline**: meter determinate ease + live sweep, permission glow-ring, event stagger + kind tint.
- **Plan/Review/Dialog**: panel rise, approval flip, completion slide, dialog scale-in + backdrop fade.
- **A11y**: global reduced-motion collapse, focus-visible rings, tabular-nums.

## GitHub Presence (files only)
- **README**: MIT badge fix, social PNG, feature grid, quickstart, architecture, verification, screenshots.
- **Templates**: PR checklist adds motion/a11y shots, issue config enables discussions link.
- **Brand**: keep SVG + PNG, reference social preview path `docs/brand/orrery-social.png`.
- **Settings (manual)**: description "Local-first mission planning, execution, and review — daemon-owned authority, replayable events, signed by default.", topics `electron react typescript theia local-first mission-control`, homepage `https://orrery-beta.vercel.app`, social preview upload.

## Tests
- `npm run typecheck`, `npm test -- --run`, `npm run build`, `mission:smoke`, `daemon:smoke`, `test:e2e`.
- axe: no critical/serious, reduced-motion CSS guard test stays green.
- e2e `enterMissionControl` selectors unchanged.

## Files
- `src/styles.css`, `src/components/app-shell.tsx`, `launch-screen.tsx`, `mission-list.tsx`, `lifecycle-rail.tsx`, `runtime-timeline.tsx`, `plan-canvas.tsx`, `review-studio.tsx`, `new-mission-dialog.tsx`, `src/hooks/use-reveal.ts`.
- `README.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/config.yml`, `docs/brand/README.md`.
