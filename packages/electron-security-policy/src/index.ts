/**
 * Shared Electron security primitives for Orrery shells.
 *
 * Both the standalone Electron shell (`electron/`) and the Theia host
 * (`theia-app/host/`) must enforce the same invariants: sandboxed windows,
 * deny-by-default permissions, no popups or untrusted navigation, and IPC
 * accepted only from the trusted renderer's main frame. These helpers are the
 * single source of truth so a policy fix lands in both shells at once.
 *
 * This package is Electron-agnostic: every function takes structural types so
 * it can be unit-tested without an Electron runtime.
 */

export interface FrameLike {
  readonly url: string;
}

export interface WebContentsLike {
  on(event: "will-navigate" | "will-redirect", listener: (event: { preventDefault(): void }, url: string) => void): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

export interface SessionLike {
  setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: (granted: boolean) => void) => void): void;
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
}

export interface WindowWebPreferences {
  preload?: string;
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  webviewTag: false;
  webSecurity: true;
}

/** The immutable webPreferences baseline every Orrery window must use. */
export function secureWebPreferences(preload?: string): WindowWebPreferences {
  return {
    ...(preload === undefined ? {} : { preload }),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    webSecurity: true,
  };
}

/** Development renderers must be loopback HTTP; everything else is rejected. */
export function isAllowedDevServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

/** The renderer is a single-page app; only the exact loaded document may be navigated to. */
export function isAllowedNavigation(destination: string, rendererUrl: string): boolean {
  return destination === rendererUrl;
}

export function denyPopup(): { action: "deny" } {
  return { action: "deny" };
}

/** Blocks popups outright and prevents navigation/redirect away from the trusted renderer URL. */
export function installNavigationPolicy(
  webContents: WebContentsLike,
  getRendererUrl: () => string,
): void {
  webContents.setWindowOpenHandler(denyPopup);
  const preventUntrustedNavigation = (event: { preventDefault(): void }, destination: string): void => {
    if (!isAllowedNavigation(destination, getRendererUrl())) event.preventDefault();
  };
  webContents.on("will-navigate", preventUntrustedNavigation);
  webContents.on("will-redirect", preventUntrustedNavigation);
}

/** Denies every permission request and check; capabilities are granted through Orrery flows, not Chromium. */
export function installDefaultDenyPermissions(session: SessionLike): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

/** IPC is accepted only from the trusted main frame, never from subframes or other documents. */
export function isTrustedIpcSender(
  senderFrame: FrameLike | null,
  mainFrame: FrameLike,
  rendererUrl: string,
): boolean {
  return senderFrame === mainFrame && senderFrame.url === rendererUrl;
}

/** A renderer URL is trusted only if its origin matches the expected origin exactly. */
export function isSameOrigin(candidateUrl: string, expectedUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(expectedUrl);
    return candidate.protocol === expected.protocol && candidate.host === expected.host;
  } catch {
    return false;
  }
}
