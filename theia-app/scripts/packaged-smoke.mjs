import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countBundledPlugins, runTheiaSmokeLaunch } from "./smoke-runtime.mjs";

/**
 * Proves the *packaged* workbench starts and renders every Mission Control view.
 *
 * The development smoke runs electron.exe against the checkout, which still has node_modules,
 * the plugins folder beside the scripts, and no asar. This one launches the product executable
 * electron-builder wrote, so it exercises the asar layout, the unpacked native addons, the
 * daemon fork from `app.asar.unpacked`, and the plugins relocated to `resources/app/plugins`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unpacked = resolve(root, "release", process.platform === "win32" ? "win-unpacked" : process.platform === "darwin" ? "mac" : "linux-unpacked");
const executable = process.platform === "win32"
  ? resolve(unpacked, "orrery-mission-control.exe")
  : process.platform === "darwin"
    ? resolve(unpacked, "Orrery Mission Control.app", "Contents", "MacOS", "Orrery Mission Control")
    : resolve(unpacked, "orrery-mission-control");
if (!existsSync(executable)) {
  process.stderr.write(`Packaged workbench not found at ${executable}; run \`npm run package -- --dir\` first.\n`);
  process.exit(1);
}

// The packaged plugins are what shipped, not what the checkout holds: count them where the
// product will read them, so a packaging config that drops extraResources fails here.
const shippedPlugins = resolve(unpacked, process.platform === "darwin" ? "Orrery Mission Control.app/Contents/Resources" : "resources", "app", "plugins");
const minimumPlugins = countBundledPlugins(shippedPlugins);
if (minimumPlugins === 0) {
  process.stderr.write(`No bundled plugins shipped at ${shippedPlugins}; the packaged workbench would have no Git or language features.\n`);
  process.exit(1);
}
await runTheiaSmokeLaunch({ executable, args: [], cwd: unpacked, minimumPlugins });
console.log(`Packaged Theia smoke passed: ${executable} started from its asar, deployed ${minimumPlugins} bundled plugins, and rendered every Mission Control view.`);
