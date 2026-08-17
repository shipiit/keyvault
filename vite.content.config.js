import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Bundles the content script into a single classic script.
 *
 * This is the one part of the extension that cannot stay unbundled. A content
 * script declared in `manifest.json` is loaded as a **classic script**, not a
 * module — Chrome offers no `type: "module"` for declarative content scripts —
 * so a top-level `import` throws
 * "Cannot use import statement outside a module" and the whole script dies
 * before it runs. The background service worker is different: it *is* declared
 * as a module, so it stays unbundled.
 *
 * Output is left unminified and without name mangling, so it remains readable
 * next to `src/content/`. The auditability argument survives bundling; it does
 * not survive minification.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist/content'),
    // The UI build writes to dist/ui and runs separately; clearing here would
    // delete whichever ran first.
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.js'),
      // IIFE: self-contained, no imports, no module scope required.
      formats: ['iife'],
      name: 'KeyVaultContentScript',
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        // Keeps identifiers close to the source for anyone reading the
        // shipped file against src/content/.
        minifyInternalExports: false,
      },
    },
  },
});
