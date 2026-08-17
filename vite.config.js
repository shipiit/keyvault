import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Builds only the UI.
 *
 * `src/background/` and `src/core/` are copied verbatim by `scripts/build.js`
 * rather than bundled, so the security-critical bytes Chrome executes are the
 * bytes in this repository and a reviewer can diff them directly.
 *
 * Tailwind is compiled to a static stylesheet here. The CDN build is not an
 * option: the extension's CSP is `script-src 'self'`, and loading styles or
 * script from a remote host is exactly what that forbids.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/ui'),
  // Relative asset paths, not Vite's default absolute ones.
  //
  // The pages live at `ui/popup.html` inside the extension, so an absolute
  // `/assets/app.js` resolves to `chrome-extension://<id>/assets/app.js` —
  // the extension root — while the files are actually under `ui/assets/`.
  // The result is a blank popup and ERR_FILE_NOT_FOUND in the console.
  base: './',
  plugins: [preact(), tailwind()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
    // Readable output. A password manager should be auditable after shipping,
    // and the few kilobytes saved by mangling are not worth losing that.
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/ui/popup.html'),
        vault: resolve(import.meta.dirname, 'src/ui/vault.html'),
      },
    },
  },
});
