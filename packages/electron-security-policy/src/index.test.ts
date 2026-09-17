import { describe, expect, it } from "vitest";
import {
  denyPopup,
  installDefaultDenyPermissions,
  installNavigationPolicy,
  isAllowedDevServerUrl,
  isAllowedNavigation,
  isSameOrigin,
  isTrustedIpcSender,
  secureWebPreferences,
  type SessionLike,
  type WebContentsLike,
} from "./index";

describe("secureWebPreferences", () => {
  it("always enforces sandbox, context isolation, and no node integration", () => {
    expect(secureWebPreferences("/preload.cjs")).toEqual({
      preload: "/preload.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    });
  });

  it("omits the preload when none is provided", () => {
    expect(secureWebPreferences()).not.toHaveProperty("preload");
  });
});

describe("isAllowedDevServerUrl", () => {
  it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])(
    "allows loopback HTTP URL %s",
    (value) => expect(isAllowedDevServerUrl(value)).toBe(true),
  );

  it.each([
    "https://localhost:5173",
    "http://0.0.0.0:5173",
    "http://example.com",
    "file:///tmp/index.html",
    "not a url",
  ])("rejects %s", (value) => expect(isAllowedDevServerUrl(value)).toBe(false));
});

describe("navigation policy", () => {
  function fakeWebContents() {
    const handlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    let popupHandler: ((details: { url: string }) => { action: "deny" }) | undefined;
    const contents: WebContentsLike = {
      on: (event, listener) => { handlers.set(event, listener); },
      setWindowOpenHandler: (handler) => { popupHandler = handler; },
    };
    return { contents, handlers, popup: (url: string) => popupHandler?.({ url }) };
  }

  it("denies every popup", () => {
    expect(denyPopup()).toEqual({ action: "deny" });
    const { contents, popup } = fakeWebContents();
    installNavigationPolicy(contents, () => "http://127.0.0.1:5173/");
    expect(popup("https://evil.example")).toEqual({ action: "deny" });
  });

  it("prevents navigation and redirects away from the renderer URL", () => {
    const { contents, handlers } = fakeWebContents();
    installNavigationPolicy(contents, () => "http://127.0.0.1:5173/");
    for (const eventName of ["will-navigate", "will-redirect"] as const) {
      let prevented = false;
      handlers.get(eventName)?.({ preventDefault: () => { prevented = true; } }, "https://evil.example");
      expect(prevented).toBe(true);
      prevented = false;
      handlers.get(eventName)?.({ preventDefault: () => { prevented = true; } }, "http://127.0.0.1:5173/");
      expect(prevented).toBe(false);
    }
  });

  it("treats subpaths of the renderer as untrusted (SPA must route client-side)", () => {
    expect(isAllowedNavigation("http://127.0.0.1:5173/settings", "http://127.0.0.1:5173/")).toBe(false);
  });
});

describe("installDefaultDenyPermissions", () => {
  it("denies permission requests and checks", () => {
    let requestResult: boolean | undefined;
    let checkResult: boolean | undefined;
    const session: SessionLike = {
      setPermissionRequestHandler: (handler) => handler({}, "media", (granted) => { requestResult = granted; }),
      setPermissionCheckHandler: (handler) => { checkResult = handler({}, "media"); return checkResult; },
    };
    installDefaultDenyPermissions(session);
    expect(requestResult).toBe(false);
    expect(checkResult).toBe(false);
  });
});

describe("isTrustedIpcSender", () => {
  const mainFrame = { url: "http://127.0.0.1:5173/" };

  it("trusts only the main frame at the exact renderer URL", () => {
    expect(isTrustedIpcSender(mainFrame, mainFrame, "http://127.0.0.1:5173/")).toBe(true);
  });

  it("rejects subframes even at the same URL", () => {
    expect(isTrustedIpcSender({ url: "http://127.0.0.1:5173/" }, mainFrame, "http://127.0.0.1:5173/")).toBe(false);
  });

  it("rejects the main frame identity at a different URL", () => {
    const moved = { url: "https://evil.example" };
    expect(isTrustedIpcSender(moved, moved, "http://127.0.0.1:5173/")).toBe(false);
  });

  it("rejects a null sender frame", () => {
    expect(isTrustedIpcSender(null, mainFrame, "http://127.0.0.1:5173/")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("matches protocol and host", () => {
    expect(isSameOrigin("http://127.0.0.1:3000/deep/path?q=1", "http://127.0.0.1:3000/")).toBe(true);
  });

  it("rejects different ports, schemes, and hosts", () => {
    expect(isSameOrigin("http://127.0.0.1:3001/", "http://127.0.0.1:3000/")).toBe(false);
    expect(isSameOrigin("https://127.0.0.1:3000/", "http://127.0.0.1:3000/")).toBe(false);
    expect(isSameOrigin("http://localhost:3000/", "http://127.0.0.1:3000/")).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(isSameOrigin("not a url", "http://127.0.0.1:3000/")).toBe(false);
  });
});
