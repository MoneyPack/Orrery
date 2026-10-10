# Architecture Decision Record: Mission Replay Debugger

**Date**: 2026-10-09  
**Status**: Accepted  
**Context**: Mission Control UI Enhancement

## Decision

Build a time-travel debugging UI that reconstructs and displays mission state at any event in the lifecycle, allowing operators to step through execution history and inspect exact domain state transitions.

## Context

Mission failures are often discovered after the fact — a mission shows `failed` or `rejected`, but the operator must reverse-engineer what went wrong from a flat event log. Understanding causality requires:

1. Knowing the mission's state at each event
2. Seeing which events led to status transitions
3. Inspecting capability requests and their resolutions
4. Correlating evidence items with their triggering events
5. Understanding why a mission is `blocked` vs `running` vs `failed`

Without a replay mechanism, this forensic work is manual, error-prone, and requires deep knowledge of the domain model.

## Decision

Implement `MissionReplayDebugger` as a standalone React component providing:

1. **Event-by-event navigation**: First/Previous/Next/Last controls with keyboard shortcuts
2. **State reconstruction**: Rebuild mission state at each event sequence number
3. **Three-panel layout**:
   - Event details (kind, timestamp, title, detail, capability requests)
   - Mission state snapshot (status, mode, activeRunId, event/change/evidence counts)
   - Visual timeline (clickable event list showing past/current/future)
4. **Evidence at each step**: Show which evidence existed at that point in time
5. **Capability request visibility**: Display pending/resolved capability requests inline

## Architecture

The debugger is **replay-based**, not **recording-based**:
- It derives state from the immutable event log
- No additional storage or instrumentation required
- Works with any existing mission that has events
- State reconstruction is deterministic and repeatable

State reconstruction algorithm:
```typescript
1. Start with initial mission state (empty events/changes/evidence)
2. For each event [0..N]:
   a. Append event to events array
   b. Capture snapshot of mission at that point
3. After all events, apply final changes/evidence to last snapshot
```

This is **approximate** — events don't perfectly map to domain actions, so we reconstruct what the state "looked like" at each event boundary rather than replaying exact `transitionMission` calls.

## Consequences

### Positive

- **Debugging insight**: Operators can pinpoint the exact event that caused a state transition
- **Capability forensics**: See which capability request blocked execution and when it was resolved
- **Evidence timeline**: Understand when each evidence item was recorded relative to events
- **Training tool**: New users can explore a completed mission's lifecycle interactively
- **Zero instrumentation cost**: Works with existing event store, no logging changes needed
- **Deterministic**: Same event log always produces same replay

### Negative

- **Approximate state reconstruction**: Since events don't directly map to actions, the "mission state" shown is reconstructed heuristically rather than being authoritative
- **Memory cost**: Builds `N` state snapshots for `N` events (mitigated by memoization)
- **Not a real debugger**: Cannot step into internal reducer logic or inspect intermediate values

### Mitigations

- Use `useMemo` to rebuild replay steps only when mission changes
- Keep state snapshots shallow (structural sharing via spread)
- Document that this is a "state viewer" not a precise time-travel debugger
- If exact state is needed, consider recording state snapshots alongside events in future (but this has storage/privacy tradeoffs)

## Implementation Notes

**Component**: `src/components/mission-replay-debugger.tsx`  
**Styling**: `src/components/mission-replay-debugger.css` (imported via `styles.css`)  
**Tests**: 16 test cases covering navigation, state display, capability rendering, timeline interaction

**Key features**:
- Starts at last event (most recent state)
- Buttons disabled at boundaries (can't go before first or after last)
- Timeline shows visual progress: past (dim), current (highlighted), future (dimmer)
- Event kinds color-coded: workspace (amber), verification (green), error (red), capability (yellow)
- Responsive layout for mobile (stacked panels)

**Future enhancements**:
- Export replay session as animated GIF for bug reports
- Add "jump to status transition" shortcuts (e.g., jump to when mission became `blocked`)
- Diff view showing what changed between two events
- Search/filter events by kind or keyword
- Keyboard shortcuts (← → for prev/next, Home/End for first/last)

## Alternatives Considered

1. **Record snapshots alongside events**: Store full mission state at each event boundary
   - **Pro**: Exact state, no reconstruction needed
   - **Con**: Storage cost, potential privacy leak (full mission in every event), breaks existing event format

2. **Backend replay API**: Daemon replays events server-side and returns state
   - **Pro**: Authoritative state reconstruction
   - **Con**: Network overhead, requires daemon enhancement, can't work offline

3. **Full domain reducer replay**: Re-run `transitionMission` for every action
   - **Pro**: Exact state transitions
   - **Con**: Events don't map 1:1 to actions, requires inferring actions from events (harder than current approach)

4. **No debugger, just improve event log formatting**: Make the flat event list easier to read
   - **Pro**: Simple, no new code
   - **Con**: Doesn't solve the "what was the state at this point?" question

## Related Decisions

- Enables better diagnostics for agent execution sessions (can replay which command triggered which event)
- Complements the existing timeline view (that view is always "current state", this is time-travel)
- May inform future event schema design (e.g., recording which action triggered each event)
