import { useState, useMemo } from "react";
import type { Mission, MissionEvent } from "@orrery/mission-control-domain";
import { transitionMission } from "@orrery/mission-control-domain";

interface ReplayStep {
  sequence: number;
  event: MissionEvent;
  missionState: Mission;
  timestamp: string;
}

export function MissionReplayDebugger({ mission }: { mission: Mission }) {
  const [currentStep, setCurrentStep] = useState(mission.events.length - 1);

  const replaySteps = useMemo(() => {
    const steps: ReplayStep[] = [];
    
    // Start with initial mission state (before any events)
    let currentState: Mission = {
      ...mission,
      events: [],
      changes: [],
      evidence: [],
      activeRunId: undefined,
      completionSummary: undefined,
      reviewDecision: undefined,
    };

    // Replay each event and capture state transitions
    for (let i = 0; i < mission.events.length; i++) {
      const event = mission.events[i];
      
      // Try to infer the action that produced this event
      // Most events don't directly map to actions, but we can reconstruct state
      currentState = {
        ...currentState,
        events: [...currentState.events, event],
      };

      steps.push({
        sequence: i,
        event,
        missionState: currentState,
        timestamp: event.timestamp,
      });
    }

    // Add final state with changes and evidence
    if (steps.length > 0) {
      const finalState = {
        ...steps[steps.length - 1].missionState,
        changes: mission.changes,
        evidence: mission.evidence,
        completionSummary: mission.completionSummary,
        reviewDecision: mission.reviewDecision,
      };
      steps[steps.length - 1] = {
        ...steps[steps.length - 1],
        missionState: finalState,
      };
    }

    return steps;
  }, [mission]);

  const currentReplayState = replaySteps[currentStep];

  if (mission.events.length === 0) {
    return (
      <div className="replay-debugger-empty">
        <p>No events to replay. This mission has not started execution yet.</p>
      </div>
    );
  }

  return (
    <div className="replay-debugger">
      <div className="replay-controls">
        <button
          onClick={() => setCurrentStep(0)}
          disabled={currentStep === 0}
          className="replay-btn"
          title="First event"
        >
          ⏮
        </button>
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="replay-btn"
          title="Previous event"
        >
          ◀
        </button>
        <span className="replay-position">
          {currentStep + 1} / {replaySteps.length}
        </span>
        <button
          onClick={() => setCurrentStep(Math.min(replaySteps.length - 1, currentStep + 1))}
          disabled={currentStep === replaySteps.length - 1}
          className="replay-btn"
          title="Next event"
        >
          ▶
        </button>
        <button
          onClick={() => setCurrentStep(replaySteps.length - 1)}
          disabled={currentStep === replaySteps.length - 1}
          className="replay-btn"
          title="Last event"
        >
          ⏭
        </button>
      </div>

      {currentReplayState && (
        <div className="replay-content">
          <div className="replay-event-panel">
            <h3>Event #{currentReplayState.sequence + 1}</h3>
            <div className="event-details">
              <div className="event-header">
                <span className={`event-kind event-kind-${currentReplayState.event.kind}`}>
                  {currentReplayState.event.kind}
                </span>
                <span className="event-timestamp">
                  {new Date(currentReplayState.event.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="event-title">{currentReplayState.event.title}</div>
              <div className="event-detail">{currentReplayState.event.detail}</div>
              
              {currentReplayState.event.capability && (
                <div className="event-capability">
                  <h4>Capability Request</h4>
                  <div className="capability-details">
                    <div><strong>Capability:</strong> {currentReplayState.event.capability.capability}</div>
                    <div><strong>Scope:</strong> {currentReplayState.event.capability.scope}</div>
                    <div><strong>Reason:</strong> {currentReplayState.event.capability.reason}</div>
                    {currentReplayState.event.capability.resolved && (
                      <div className={`capability-resolution capability-${currentReplayState.event.capability.resolved}`}>
                        <strong>Resolution:</strong> {currentReplayState.event.capability.resolved}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="replay-state-panel">
            <h3>Mission State at This Point</h3>
            <div className="state-details">
              <div className="state-row">
                <span className="state-label">Status:</span>
                <span className={`mission-status-badge status-${currentReplayState.missionState.status}`}>
                  {currentReplayState.missionState.status}
                </span>
              </div>
              <div className="state-row">
                <span className="state-label">Mode:</span>
                <span className="state-value">{currentReplayState.missionState.mode}</span>
              </div>
              <div className="state-row">
                <span className="state-label">Active Run:</span>
                <span className="state-value">
                  {currentReplayState.missionState.activeRunId || "none"}
                </span>
              </div>
              <div className="state-row">
                <span className="state-label">Workspace:</span>
                <span className="state-value">
                  {currentReplayState.missionState.workspaceId || "not created"}
                </span>
              </div>
              <div className="state-row">
                <span className="state-label">Events So Far:</span>
                <span className="state-value">{currentReplayState.missionState.events.length}</span>
              </div>
              <div className="state-row">
                <span className="state-label">File Changes:</span>
                <span className="state-value">{currentReplayState.missionState.changes.length}</span>
              </div>
              <div className="state-row">
                <span className="state-label">Evidence Items:</span>
                <span className="state-value">{currentReplayState.missionState.evidence.length}</span>
              </div>
              {currentReplayState.missionState.reviewDecision && (
                <div className="state-row">
                  <span className="state-label">Review Decision:</span>
                  <span className={`state-value decision-${currentReplayState.missionState.reviewDecision}`}>
                    {currentReplayState.missionState.reviewDecision}
                  </span>
                </div>
              )}
            </div>

            {currentReplayState.missionState.evidence.length > 0 && (
              <div className="state-evidence">
                <h4>Evidence at This Point ({currentReplayState.missionState.evidence.length} items)</h4>
                <div className="evidence-list">
                  {currentReplayState.missionState.evidence.map((ev) => (
                    <div key={ev.id} className={`evidence-item evidence-${ev.status}`}>
                      <div className="evidence-summary">{ev.summary}</div>
                      <div className="evidence-meta">
                        <span className="evidence-kind">{ev.kind}</span>
                        <span className="evidence-status">{ev.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="replay-timeline-panel">
            <h3>Event Timeline</h3>
            <div className="timeline-visual">
              {replaySteps.map((step, idx) => (
                <div
                  key={step.sequence}
                  className={`timeline-item ${idx === currentStep ? "timeline-item-current" : ""} ${idx < currentStep ? "timeline-item-past" : "timeline-item-future"}`}
                  onClick={() => setCurrentStep(idx)}
                  title={`${step.event.kind}: ${step.event.title}`}
                >
                  <div className={`timeline-marker timeline-marker-${step.event.kind}`} />
                  <div className="timeline-label">
                    {idx + 1}. {step.event.kind}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
