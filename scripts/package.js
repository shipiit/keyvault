/**
 * Package `dist/` into a zip for sharing or installing elsewhere.
 *
 * Chrome cannot load a zip directly — "Load unpacked" wants a folder — so
 * this is a transport format, not an installer. The recipient unzips it and
 * loads the folder. That is stated in the output because it is the step
 * people miss.
 *
 * Uses the system `zip`, present on macOS and Linux, rather than adding a
 * dependency to compress a folder once.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'manifest.json'))) {
  throw new Error('dist/ is missing or incomplete — run `npm run build` first');
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `keyvault-${version}.zip`;
const target = join(root, name);

rmSync(target, { force: true });

// -r recurse, -q quiet, -X drop macOS resource forks so the archive holds
// only the files a reviewer would expect to see.
execFileSync('zip', ['-rqX', target, '.'], { cwd: dist, stdio: 'inherit' });

const size = (readFileSync(target).length / 1024).toFixed(0);
console.warn(`Packaged ${name} (${size}KB)`);
console.warn('');
console.warn('To install it:');
console.warn(`  1. Unzip ${name} — Chrome cannot load a zip directly`);
console.warn('  2. Open chrome://extensions and turn on Developer mode');
console.warn('  3. Click "Load unpacked" and choose the unzipped folder');
