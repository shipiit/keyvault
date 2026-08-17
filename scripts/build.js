/**
 * Build the loadable extension into `dist/`.
 *
 * Deliberately a plain copy, not a bundle. Manifest V3 service workers
 * support native ES modules, so `src/` runs as-is — which means the bytes
 * Chrome executes are the bytes in this repository. For a password manager
 * that is worth more than the few kilobytes a bundler would save: a reviewer
 * can diff `dist/` against `src/` and see there is nothing else in there.
 *
 * A bundler becomes necessary in stage 3, when the UI arrives. The crypto
 * core should stay unminified even then.
 */

import { cp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full, base)));
    } else {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Copy the manifest plus the unbundled background, content and core layers.
await cp(join(src, 'manifest.json'), join(dist, 'manifest.json'));
await cp(join(src, 'background'), join(dist, 'background'), { recursive: true });
await cp(join(src, 'content'), join(dist, 'content'), { recursive: true });
await cp(join(src, 'core'), join(dist, 'core'), { recursive: true });
await cp(join(src, 'icons'), join(dist, 'icons'), { recursive: true });

// The UI is compiled by Vite (Tailwind needs a build step, and the CSP
// forbids loading it from a CDN). Its output already lands in dist/ui.
await new Promise((resolvePromise, rejectPromise) => {
  const vite = spawn('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
  vite.on('exit', (code) =>
    code === 0 ? resolvePromise() : rejectPromise(new Error(`vite build failed (${code})`)),
  );
});

// The manifest version is the one users see; keep it honest against package.json.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifestPath = join(dist, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// A manifest that names a missing file fails at load time with an opaque
// message, so check it here where the error can say what is wrong.
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  // Icons too: a missing one shows as a silent grey placeholder rather than
  // an error, which is exactly the kind of thing that ships unnoticed.
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);

for (const relative of referenced) {
  if (!existsSync(join(dist, relative))) {
    throw new Error(`manifest references ${relative}, which is not in dist/`);
  }
}

// Verify that every asset the built HTML references actually resolves.
//
// Vite emits absolute paths by default, which silently break inside an
// extension because the pages are not served from the root. That failure
// shows up only as a blank popup at runtime, so it is caught here instead.
for (const page of ['ui/popup.html', 'ui/vault.html']) {
  const pagePath = join(dist, page);
  const html = await readFile(pagePath, 'utf8');

  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:|#)/.test(reference)) {
      continue;
    }
    if (reference.startsWith('/')) {
      throw new Error(
        `${page} references "${reference}" with an absolute path. ` +
          'Extension pages are not served from the root — set `base` in vite.config.js.',
      );
    }
    const resolved = join(dirname(pagePath), reference);
    if (!existsSync(resolved)) {
      throw new Error(`${page} references "${reference}", which does not exist in dist/`);
    }
  }
}

const files = await listFiles(dist);
console.warn(`Built dist/ — ${files.length} files`);
console.warn('Load it with: chrome://extensions → Developer mode → Load unpacked → dist/');
