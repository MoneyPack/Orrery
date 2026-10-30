import { allow, deny, type Permission, type PermissionDecision } from "@orrery/mission-control-domain";
import { isTrustedIpcSender } from "./policy";

/** Structural sender identity, mirroring the shared policy's FrameLike pair. */
export interface IpcSenderTrustRequest {
  readonly senderFrame: { readonly url: string } | null;
  readonly mainFrame: { readonly url: string };
  readonly rendererUrl: string;
}

/**
 * Renderer-to-main IPC validation as a shared Permission: check is the
 * main-frame-at-the-exact-renderer-URL decision, with no approve or revoke —
 * sender trust is fixed by the window that loaded the renderer, not minted
 * or withdrawn at runtime.
 */
export const ipcSenderTrustPermission: Permission<IpcSenderTrustRequest, true> = {
  system: "ipc-sender-trust",
  check(request) {
    return ipcSenderTrustDecision(request);
  },
};

/** Pure decision form, so callers can combine it with payload checks via `allOf`. */
export function ipcSenderTrustDecision(request: IpcSenderTrustRequest): PermissionDecision<true> {
  return isTrustedIpcSender(request.senderFrame, request.mainFrame, request.rendererUrl)
    ? allow()
    : deny("Untrusted IPC sender");
}

/** Test helper: render the frames the way the shared policy expects them. */
export function trustedSender(rendererUrl: string): IpcSenderTrustRequest {
  const mainFrame = { url: rendererUrl };
  return { senderFrame: mainFrame, mainFrame, rendererUrl };
}
