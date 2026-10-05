import type { App, BrowserWindowConstructorOptions, Session, WebContents, WebFrameMain } from "electron";
import { win32 as win32Path } from "node:path";
import {
  denyPopup,
  installDefaultDenyPermissions as installSharedDefaultDenyPermissions,
  isAllowedDevServerUrl as isAllowedSharedDevServerUrl,
  isAllowedNavigation as isAllowedSharedNavigation,
  isTrustedIpcSender as isTrustedSharedIpcSender,
  secureWebPreferences,
} from "@orrery/electron-security-policy";

export type RendererSource =
  | { kind: "url"; value: string }
  | { kind: "file"; value: string };

export function createWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: secureWebPreferences(preload),
  };
}

export function isAllowedDevServerUrl(value: string): boolean {
  return isAllowedSharedDevServerUrl(value);
}

export function resolveRendererSource(
  isPackaged: boolean,
  developmentUrl: string | undefined,
  appPath: string,
): RendererSource {
  if (isPackaged) {
    // Packaged builds ship for Windows only; app.getAppPath() is a native path there, so join
    // with win32 semantics to avoid host-dependent separators (running the tests or a build on
    // Linux must not change what a Windows package would compute).
    return { kind: "file", value: win32Path.join(appPath, "dist", "index.html") };
  }

  if (!developmentUrl || !isAllowedDevServerUrl(developmentUrl)) {
    throw new Error("Electron development server must use a loopback HTTP URL");
  }

  return { kind: "url", value: new URL(developmentUrl).href };
}

export function resolvePreloadPath(mainEntryPath: string): string {
  return win32Path.join(win32Path.dirname(mainEntryPath), "preload.cjs");
}

export function resolveDaemonEntryPath(mainEntryPath: string): string {
  return win32Path.join(win32Path.dirname(mainEntryPath), "resources", "mission-control-daemon.cjs");
}

export function installGracefulShutdown(target: Pick<App, "on" | "quit">, cleanup: () => Promise<void>): void {
  let quitAfterCleanup = false;
  let pending: Promise<void> | undefined;
  target.on("before-quit", event => {
    if (quitAfterCleanup) return;
    event.preventDefault();
    pending ??= cleanup().then(() => {
      quitAfterCleanup = true;
      target.quit();
    }, error => {
      console.error(error);
      pending = undefined;
    });
  });
}

export function isAllowedNavigation(destination: string, rendererUrl: string): boolean {
  return isAllowedSharedNavigation(destination, rendererUrl);
}

export function popupPolicy(): { action: "deny" } {
  return denyPopup();
}

export function installNavigationPolicy(
  webContents: Pick<WebContents, "on" | "setWindowOpenHandler">,
  getRendererUrl: () => string,
): void {
  webContents.setWindowOpenHandler(popupPolicy);
  const preventUntrustedNavigation = (event: { preventDefault(): void }, destination: string): void => {
    if (!isAllowedNavigation(destination, getRendererUrl())) event.preventDefault();
  };
  webContents.on("will-navigate", preventUntrustedNavigation);
  webContents.on("will-redirect", preventUntrustedNavigation);
}

export function installDefaultDenyPermissions(target: Pick<Session, "setPermissionCheckHandler" | "setPermissionRequestHandler">): void {
  installSharedDefaultDenyPermissions(target);
}

export function isTrustedIpcSender(
  senderFrame: Pick<WebFrameMain, "url"> | null,
  mainFrame: Pick<WebFrameMain, "url">,
  rendererUrl: string,
): boolean {
  return isTrustedSharedIpcSender(senderFrame, mainFrame, rendererUrl);
}
