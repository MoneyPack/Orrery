/**
 * Orrery adjustments to Theia's generated ESBuild pipeline. Theia writes this file only when it
 * is absent, so it is committed; `gen-esbuild.*.mjs` stay generated.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);

/**
 * @vscode/windows-ca-certs is an optional native addon of the extension host's proxy agent.
 * Theia's bundle plugin resolves it straight to `build/Release/crypt32.node`, which only
 * exists when the addon was compiled, and compiling it needs Spectre-mitigated VC libraries
 * that a plain MSVC install lacks. @vscode/proxy-agent already falls back to Node's bundled
 * CA store when the require throws (`readCaCertificates().catch`), so when the addon is
 * absent this marks it external and lets that fallback run. When it is present this plugin
 * defers and Theia's resolution applies unchanged.
 *
 * @type {import('esbuild').Plugin}
 */
const optionalWindowsCaCertsPlugin = {
    name: 'orrery-optional-windows-ca-certs',
    setup(build) {
        build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, () => {
            let packageDir;
            try {
                packageDir = dirname(require.resolve('@vscode/windows-ca-certs/package.json'));
            } catch {
                return { path: '@vscode/windows-ca-certs', external: true };
            }
            const addon = join(packageDir, 'build', 'Release', 'crypt32.node');
            return existsSync(addon) ? undefined : { path: '@vscode/windows-ca-certs', external: true };
        });
    },
};

const nodeOptionsWithOptionalNatives = {
    ...nodeOptions,
    plugins: [optionalWindowsCaCertsPlugin, ...(nodeOptions.plugins ?? [])],
};

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptionsWithOptionalNatives);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch {
        process.exit(1);
    }
}
