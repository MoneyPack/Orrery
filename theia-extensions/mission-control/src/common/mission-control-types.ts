import type { Mission, MissionControlPublicApi, MissionListItem, ReviewDecision, RepositoryIntakeInput, MissionCreateInput, MissionRunInput, MissionCancelInput, IntelligenceMessage, IntelligenceSettingsInput, IntelligenceSettingsStatus, IntelligenceTurnStatus, McpActivityEntry, McpCatalog, McpInvokeResult, McpRegisterInput, McpServerStatus, McpToolDecision, McpToolStatus } from "./mission-control-contracts";

export const MissionControlService = Symbol("MissionControlService");
export const OrreryIntelligenceService = Symbol("OrreryIntelligenceService");
export const OrreryToolsService = Symbol("OrreryToolsService");

export interface OrreryToolsState {
  readonly servers: ReadonlyArray<McpServerStatus>;
  readonly tools: ReadonlyArray<McpToolStatus>;
  readonly activity: ReadonlyArray<McpActivityEntry>;
  /** The most recent invocation result. Untrusted server output: render as plain text. */
  readonly lastResult?: McpInvokeResult;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string;
  readonly notice?: string;
  /** The effect landed but the catalog could not be re-read, so this view may be out of date. */
  readonly stale?: boolean;
}

export interface OrreryToolsService {
  load(): Promise<OrreryToolsState>;
  register(input: Omit<McpRegisterInput, "intentId">): Promise<OrreryToolsState>;
  remove(serverId: string): Promise<OrreryToolsState>;
  decide(serverId: string, name: string, decision: McpToolDecision): Promise<OrreryToolsState>;
  invoke(serverId: string, name: string, args: Readonly<Record<string, unknown>>): Promise<OrreryToolsState>;
}

export interface OrreryIntelligenceState {
  readonly threadId: string;
  readonly messages: ReadonlyArray<IntelligenceMessage>;
  readonly settings: IntelligenceSettingsStatus;
  readonly loading?: boolean;
  readonly sending?: boolean;
  /** Live state of an in-flight turn, so a native confirmation is never unexplained. */
  readonly turn?: IntelligenceTurnStatus;
  readonly error?: string;
}

export interface OrreryIntelligenceService {
  load(threadId: string): Promise<OrreryIntelligenceState>;
  send(threadId: string, text: string, missionId?: string): Promise<OrreryIntelligenceState>;
  clear(threadId: string): Promise<OrreryIntelligenceState>;
  /** Reads in-flight turn status. Status only: it starts, stops, and authorizes nothing. */
  turnStatus(threadId: string): Promise<IntelligenceTurnStatus>;
  /** Asks an in-flight turn to stop. Work already confirmed still completes and is recorded. */
  cancelTurn(threadId: string): Promise<void>;
  configure(input: Omit<IntelligenceSettingsInput, "intentId">): Promise<OrreryIntelligenceState>;
}

export interface MissionControlState {
  readonly missions: ReadonlyArray<MissionListItem>;
  readonly selectedId?: string;
  readonly selected?: Mission;
  readonly loading?: boolean;
  readonly pendingReview?: boolean;
  readonly pendingAction?: string;
  readonly repository?: { readonly repositoryId: string; readonly canonicalRoot: string; readonly fingerprint: string };
  readonly error?: string;
}

/**
 * The desktop capability the Electron preload exposes as `window.orreryMissionControl`.
 *
 * This is the same flat surface as `MissionControlPublicApi`; the alias is kept because the
 * browser adapters consume it under this name. Methods grouped by sensitivity (the full
 * rationale lives on `MissionControlPublicApi` in `mission-control-contracts.ts`):
 *
 * - Missions — `intakeRepository`, `create`, `run`, `cancel`, `list`, `getSnapshot`,
 *   `inspect`, `reviewAndPromote`: mission lifecycle and review. All guarded by Electron
 *   main's trusted-window check; intake and review additionally run through the window-bound
 *   request context because they raise native confirmations.
 * - Intelligence — `getIntelligenceSettings`, `setIntelligenceSettings`,
 *   `listIntelligenceMessages`, `sendIntelligenceMessage`, `clearIntelligenceThread`,
 *   `getIntelligenceTurnStatus`, `cancelIntelligenceTurn`: chat settings, transcript, and
 *   turn control. Credentials and endpoints never cross the bridge; the settings read returns
 *   the redacted status. Sending a message is window-bound because a turn can raise native
 *   tool confirmations; turn status/cancel authorize nothing.
 * - MCP — `listMcpCatalog`, `registerMcpServer`, `removeMcpServer`, `setMcpToolDecision`,
 *   `invokeMcpTool`, `listMcpActivity`: tool catalog and activity. Server commands, argument
 *   vectors, and endpoint URLs stay in the main process; registration, standing decisions,
 *   and invocation raise native confirmations and are window-bound.
 *
 * Enforcement does not live in this type: the exposed key set is pinned by the preload and
 * packaging tests, and every channel's payload and sender frame are validated in
 * `src/electron-main/mission-control-electron-main-contribution.ts`.
 */
export type DesktopMissionApi = MissionControlPublicApi;

export interface MissionControlService {
  load(selectedId?: string): Promise<MissionControlState>;
  getMission(missionId: string): Promise<Mission>;
  intakeRepository(input: RepositoryIntakeInput): Promise<MissionControlState>;
  create(input: MissionCreateInput): Promise<MissionControlState>;
  run(input: MissionRunInput): Promise<MissionControlState>;
  cancel(input: MissionCancelInput): Promise<MissionControlState>;
  review(mission: Mission, decision: Exclude<ReviewDecision, "revision_requested">): Promise<Mission>;
}

declare global {
  interface Window {
    readonly orreryMissionControl?: DesktopMissionApi;
  }
}
