import { useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button.jsx';
import { PasswordField } from '../components/Field.jsx';
import { send } from '../lib/messaging.js';
import { MIN_PASSPHRASE_LENGTH, describeBackup } from '../../core/backup.js';
import { importAny } from '../../core/importers.js';

/**
 * Backup, restore, and import.
 *
 * The most important panel in settings. The vault exists on one device with
 * no server holding a copy, so until a backup exists, a failed disk is the
 * end of every credential in it.
 */
export function BackupSection({ onChanged }) {
  const [mode, setMode] = useState(null);

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold">Backup and import</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-fg-muted)]">
        Your vault is on this device only. Nothing else holds a copy, so a backup is the only way to
        survive a lost or wiped machine.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant={mode === 'export' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode(mode === 'export' ? null : 'export')}
        >
          Export encrypted backup
        </Button>
        <Button
          variant={mode === 'restore' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode(mode === 'restore' ? null : 'restore')}
        >
          Restore from backup
        </Button>
        <Button
          variant={mode === 'import' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode(mode === 'import' ? null : 'import')}
        >
          Import from another manager
        </Button>
      </div>

      {mode === 'export' && <ExportPanel />}
      {mode === 'restore' && <RestorePanel onChanged={onChanged} />}
      {mode === 'import' && <ImportPanel onChanged={onChanged} />}
    </section>
  );
}

function ExportPanel() {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState({ status: 'idle' });

  const tooShort = passphrase !== '' && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm !== '' && confirm !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm === passphrase;

  async function exportNow(event) {
    event.preventDefault();
    if (!ready) return;

    setState({ status: 'working' });
    try {
      const { backup, filename } = await send('backup/create', { passphrase });

      // Written from the UI because the background has no file access. The
      // object URL is revoked immediately after the click so the encrypted
      // blob does not linger in memory for the life of the page.
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      setState({ status: 'done', filename });
      setPassphrase('');
      setConfirm('');
    } catch (error) {
      setState({ status: 'failed', reason: error.message });
    }
  }

  return (
    <Panel>
      <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
        The backup is encrypted with a passphrase of its own, not your master password. A backup
        travels — to a drive, another machine, a cloud folder — and your master password should not
        travel with it.
      </p>

      <form onSubmit={exportNow} className="mt-3 flex flex-col gap-3">
        <PasswordField
          label="Backup passphrase"
          masterPassword
          value={passphrase}
          hint={`At least ${MIN_PASSPHRASE_LENGTH} characters.`}
          error={tooShort ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters` : null}
          onInput={(event) => setPassphrase(event.currentTarget.value)}
        />
        <PasswordField
          label="Confirm passphrase"
          masterPassword
          value={confirm}
          error={mismatch ? 'Passphrases do not match' : null}
          onInput={(event) => setConfirm(event.currentTarget.value)}
        />

        <p className="rounded-[var(--radius-field)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 p-2.5 text-xs leading-relaxed">
          Store this passphrase somewhere other than the vault it backs up. A backup you cannot open
          is not a backup.
        </p>

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!ready}
          loading={state.status === 'working'}
        >
          Download backup
        </Button>
      </form>

      {state.status === 'done' && (
        <p className="mt-2 text-xs text-[var(--color-success)]" role="status">
          Saved as {state.filename}.
        </p>
      )}
      {state.status === 'failed' && (
        <p className="mt-2 text-xs text-[var(--color-danger)]" role="alert">
          {state.reason}
        </p>
      )}
    </Panel>
  );
}

function RestorePanel({ onChanged }) {
  const [file, setFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [state, setState] = useState({ status: 'idle' });
  const inputRef = useRef(null);

  async function pick(event) {
    const chosen = event.currentTarget.files?.[0];
    if (chosen === undefined) return;

    const text = await chosen.text();
    try {
      // Described before asking for a passphrase, so the user can confirm
      // they picked the file they meant.
      const info = describeBackup(text);
      setFile({ text, name: chosen.name, ...info });
      setState({ status: 'idle' });
    } catch (error) {
      setFile(null);
      setState({ status: 'failed', reason: error.message });
    }
  }

  async function restore(event) {
    event.preventDefault();
    if (file === null || passphrase === '') return;

    setState({ status: 'working' });
    try {
      const result = await send('backup/restore', { backup: file.text, passphrase });
      setState({ status: 'done', ...result });
      setPassphrase('');
      onChanged?.();
    } catch (error) {
      setState({ status: 'failed', reason: error.message });
    }
  }

  return (
    <Panel>
      <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
        Restoring <strong className="font-semibold text-[var(--color-fg)]">merges</strong> the
        backup into this vault. Nothing already here is removed or overwritten, so a restore can
        never cost you anything you have added since.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={pick}
      />
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => inputRef.current?.click()}
      >
        Choose backup file
      </Button>

      {file !== null && (
        <form onSubmit={restore} className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-[var(--color-fg-muted)]">
            {file.name} — {file.entryCount ?? '?'} items
            {file.createdAt !== null && `, from ${new Date(file.createdAt).toLocaleDateString()}`}
          </p>
          <PasswordField
            label="Backup passphrase"
            masterPassword
            value={passphrase}
            onInput={(event) => setPassphrase(event.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={passphrase === ''}
            loading={state.status === 'working'}
          >
            Restore
          </Button>
        </form>
      )}

      {state.status === 'done' && (
        <p className="mt-2 text-xs text-[var(--color-success)]" role="status">
          Restored {state.added} {state.added === 1 ? 'item' : 'items'}
          {state.skipped > 0 && `, skipped ${state.skipped} already here`}.
        </p>
      )}
      {state.status === 'failed' && (
        <p className="mt-2 text-xs text-[var(--color-danger)]" role="alert">
          {state.reason}
        </p>
      )}
    </Panel>
  );
}

function ImportPanel({ onChanged }) {
  const [state, setState] = useState({ status: 'idle' });
  const inputRef = useRef(null);

  async function pick(event) {
    const chosen = event.currentTarget.files?.[0];
    if (chosen === undefined) return;

    setState({ status: 'working' });
    try {
      const { entries, format } = importAny(await chosen.text(), chosen.name);
      const result = await send('backup/import', { entries });
      setState({ status: 'done', format, ...result });
      onChanged?.();
    } catch (error) {
      setState({ status: 'failed', reason: error.message });
    }
  }

  return (
    <Panel>
      <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
        Reads CSV exports from 1Password, Bitwarden, LastPass, Chrome, Edge, Safari and Firefox, and
        Bitwarden JSON. The format is detected from the file.
      </p>
      <p className="mt-2 rounded-[var(--radius-field)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 p-2.5 text-xs leading-relaxed">
        An export file holds every password in plain text. Delete it as soon as the import finishes,
        and empty your trash.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="sr-only"
        onChange={pick}
      />
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        loading={state.status === 'working'}
        onClick={() => inputRef.current?.click()}
      >
        Choose export file
      </Button>

      {state.status === 'done' && (
        <p className="mt-2 text-xs text-[var(--color-success)]" role="status">
          Imported {state.added} {state.added === 1 ? 'item' : 'items'} from {state.format}
          {state.skipped > 0 && `, skipped ${state.skipped} that could not be read`}.
        </p>
      )}
      {state.status === 'failed' && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-danger)]" role="alert">
          {state.reason}
        </p>
      )}
    </Panel>
  );
}

function Panel({ children }) {
  return (
    <div className="mt-4 rounded-[var(--radius-field)] bg-[var(--color-field)] p-4">{children}</div>
  );
}
