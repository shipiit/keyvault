import { useEffect, useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { send } from '../lib/messaging.js';
import {
  isSupported,
  storedHandle,
  chooseFile,
  forgetHandle,
  ensurePermission,
  readDocument,
  writeDocument,
} from '../lib/sync-file.js';

/**
 * Sync, phase one: a button.
 *
 * You pick a file inside a folder your computer already synchronises, and
 * KeyVault reads and writes it. Nothing here talks to a provider — the
 * syncing is done by software you already trust with your files, so there is
 * no account to create, no token to store, and no request to anywhere.
 *
 * Manual on purpose to begin with. Merging two copies of a vault is the part
 * of a password manager that loses data, and it should be watched working
 * before anything automatic depends on it.
 */
export function SyncSection() {
  const [handle, setHandle] = useState(null);
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    storedHandle().then(setHandle);
  }, []);

  if (!isSupported()) {
    return (
      <p className="text-sm leading-relaxed text-[var(--color-fg-muted)]">
        This browser cannot open a file for reading and writing, so file-based sync is not available
        here. Exporting an encrypted backup still works.
      </p>
    );
  }

  async function pick() {
    const chosen = await chooseFile();
    if (chosen !== null) {
      setHandle(chosen);
      setState({ status: 'idle' });
    }
  }

  async function syncNow() {
    setState({ status: 'working' });
    try {
      if (!(await ensurePermission(handle))) {
        setState({
          status: 'error',
          message: 'Permission to use that file was declined. Choose it again to continue.',
        });
        return;
      }

      // Read, merge in the background where the key lives, write back what
      // it returns. The file's contents are sealed at every point on this
      // path; this page never sees a decrypted vault.
      const remoteDocument = await readDocument(handle);
      const { document, summary, report } = await send('sync/merge', {
        remoteDocument,
        remoteName: 'another device',
      });
      await writeDocument(handle, document);

      setState({ status: 'done', summary, report });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[62ch] text-sm leading-relaxed text-[var(--color-fg-muted)]">
        Choose a file inside a folder your computer already syncs — iCloud Drive, Dropbox, OneDrive,
        Syncthing. KeyVault writes your encrypted vault there and reads it back. Whatever carries
        the file between machines sees ciphertext and nothing else, and KeyVault never learns which
        service it is.
      </p>

      {handle === null ? (
        <Button variant="primary" size="sm" className="self-start" onClick={pick}>
          Choose a sync file
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2">
            <Icon.Document className="size-4 shrink-0 text-[var(--color-fg-muted)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{handle.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await forgetHandle();
                setHandle(null);
              }}
            >
              Change
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              loading={state.status === 'working'}
              onClick={syncNow}
            >
              Sync now
            </Button>

            {state.status === 'done' && (
              <span className="text-sm text-[var(--color-success)]" role="status">
                {state.summary}
              </span>
            )}
            {state.status === 'error' && (
              <span className="text-sm text-[var(--color-danger)]" role="alert">
                {state.message}
              </span>
            )}
          </div>

          {/* A conflict is not a failure, but it does need explaining, or the
              duplicate looks like a bug. */}
          {state.status === 'done' && state.report?.conflicts?.length > 0 && (
            <p className="max-w-[62ch] rounded-[var(--radius-field)] bg-[var(--color-warn)]/10 p-3 text-xs leading-relaxed text-[var(--color-warn)]">
              Both machines had changed{' '}
              {state.report.conflicts.map((conflict) => conflict.title).join(', ')} since the last
              sync, so both versions were kept and the incoming one is tagged <code>conflict</code>.
              Nothing was overwritten — compare them and delete whichever you do not want.
            </p>
          )}

          {state.status === 'done' && state.report?.resurrected?.length > 0 && (
            <p className="max-w-[62ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
              {state.report.resurrected.map((item) => item.title).join(', ')} came back: deleted
              here, but edited on the other machine after that. An edit beats a delete, because a
              lost edit is invisible and a restored item is not.
            </p>
          )}
        </>
      )}

      <p className="max-w-[62ch] text-xs leading-relaxed text-[var(--color-fg-subtle)]">
        Manual for now, deliberately. Merging two copies of a vault is where password managers lose
        data, and it is worth watching it work before anything automatic depends on it. Both
        machines must use the same master password — that is what makes the file readable on the
        other end, and unreadable to whatever carries it.
      </p>
    </div>
  );
}
