import { render } from 'preact';
import './styles.css';

/**
 * Full-page vault manager.
 *
 * Placeholder: the list/detail layout, folders, generator and import/export
 * land with the rest of stage 3. The page exists now so the manifest, build
 * and routing are wired and testable.
 */
function App() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">KeyVault</h1>
      <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
        The full vault manager is still being built. Use the toolbar popup for now.
      </p>
    </main>
  );
}

render(<App />, document.getElementById('root'));
