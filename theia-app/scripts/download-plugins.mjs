import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Populates the bundled plugin directory from `theiaPlugins` in package.json.
 *
 * Theia's local-dir resolver treats every direct child of the plugins directory as one plugin
 * (a folder with a package.json, or a .vsix). A tarball such as the VS Code builtins is
 * therefore flattened: its extension folders become direct children, and any wrapper folder
 * the archive adds is removed. `theiaPluginsExcludeIds` is applied by the real
 * `publisher.name` id read from each extracted manifest, not by folder name.
 *
 * Idempotent: an id whose marker file already records the same URL is skipped.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const pluginsDir = resolve(root, manifest.theiaPluginsDir ?? "plugins");
const plugins = manifest.theiaPlugins ?? {};
const excluded = new Set(manifest.theiaPluginsExcludeIds ?? []);
// Markers live outside the plugins directory: Theia's local-dir resolver treats every entry
// there as a plugin, and the directory is shipped verbatim as extraResources.
const markersDir = resolve(root, ".tmp", "plugin-sources");
await mkdir(pluginsDir, { recursive: true });
await mkdir(markersDir, { recursive: true });
for (const stale of await readdir(pluginsDir)) {
  if (stale.endsWith(".source")) await rm(join(pluginsDir, stale), { force: true });
}

for (const [id, url] of Object.entries(plugins)) {
  const marker = join(markersDir, `${id}.source`);
  if (await readFile(marker, "utf8").then(current => current.trim() === url, () => false)) {
    console.log(`plugins: ${id} already present from ${url}`);
    continue;
  }
  console.log(`plugins: downloading ${id} from ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`plugins: ${id} download failed with HTTP ${response.status}`);
  if (url.endsWith(".vsix")) {
    const scratch = await mkdtemp(join(tmpdir(), "orrery-plugins-"));
    try {
      const archive = join(scratch, `${id}.vsix`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
      await unpackVsix(archive, join(pluginsDir, id));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
    const scratch = await mkdtemp(join(tmpdir(), "orrery-plugins-"));
    try {
      const archive = join(scratch, basename(url));
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
      const extracted = join(scratch, "extracted");
      await mkdir(extracted);
      const tar = require("tar");
      await tar.x({ file: archive, cwd: extracted });
      // The VS Code builtins archive is a flat set of `<publisher>.<name>.vsix` files.
      for (const entry of await readdir(extracted, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".vsix")) continue;
        const pluginId = entry.name.slice(0, -".vsix".length);
        if (excluded.has(pluginId)) {
          console.log(`plugins: excluding ${pluginId}`);
          continue;
        }
        await unpackVsix(join(extracted, entry.name), join(pluginsDir, pluginId));
      }
      for (const folder of await flattenedExtensionFolders(extracted)) {
        const pluginId = await extensionId(folder);
        if (pluginId && excluded.has(pluginId)) {
          console.log(`plugins: excluding ${pluginId}`);
          continue;
        }
        await moveInto(folder, join(pluginsDir, basename(folder)));
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else {
    throw new Error(`plugins: ${id} has an unsupported archive type: ${url}`);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(marker, `${url}\n`);
}
console.log(`plugins: ready in ${pluginsDir}`);

/**
 * Unpacks a .vsix into a plugin directory.
 *
 * Bundled (system) plugins are never unpacked by Theia at runtime: `PluginDeployerImpl` only
 * routes *user* installs through the vsix file handler and warns "please unpack the plugin
 * manually" for anything else, deploying zero plugins. The expected shape is the archive as-is
 * (`extension.vsixmanifest` beside an `extension/` folder), which
 * `PluginVsCodeDirectoryHandler.resolveFromVSIX` accepts.
 */
async function unpackVsix(archive, target) {
  const decompress = require("decompress");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await decompress(archive, target);
  const manifest = join(target, "extension.vsixmanifest");
  if (!(await stat(manifest).then(() => true, () => false))) {
    throw new Error(`plugins: ${basename(archive)} did not contain extension.vsixmanifest after unpacking`);
  }
}

async function moveInto(source, target) {
  await rm(target, { recursive: true, force: true });
  try {
    await rename(source, target);
  } catch {
    // Temp and target may be on different volumes; fall back to a copy.
    const { cp } = await import("node:fs/promises");
    await cp(source, target, { recursive: true });
  }
}

/** Descends through wrapper folders until a level that holds extension folders is reached. */
async function flattenedExtensionFolders(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
  const folders = entries.map(entry => join(directory, entry.name));
  const withManifest = [];
  for (const folder of folders) {
    if (await stat(join(folder, "package.json")).then(() => true, () => false)) withManifest.push(folder);
  }
  if (withManifest.length > 0) return withManifest;
  if (folders.length === 1) return flattenedExtensionFolders(folders[0]);
  return [];
}

async function extensionId(folder) {
  try {
    const pkg = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
    return pkg.publisher && pkg.name ? `${pkg.publisher}.${pkg.name}` : undefined;
  } catch {
    return undefined;
  }
}
