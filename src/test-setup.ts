import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vitest } from "vitest";

// Component and state tests drive real timers (fixture-run async loops, axe.run on a mounted
// jsdom tree) and share the machine with heavier daemon/git suites. The repo already scales
// readiness budgets with ORRERY_TEST_TIMEOUT_SCALE; apply the same scale to the per-test
// timeout so a loaded machine reports slow-but-correct as green instead of flaky red.
const timeoutScale = Math.max(1, Number(process.env.ORRERY_TEST_TIMEOUT_SCALE ?? 1) || 1);
vitest.setConfig({ testTimeout: 5_000 * timeoutScale, hookTimeout: 10_000 * timeoutScale });

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => [...storage.keys()][index] ?? null,
  removeItem: (key) => storage.delete(key),
  setItem: (key, value) => storage.set(key, String(value)),
};

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};

afterEach(cleanup);
