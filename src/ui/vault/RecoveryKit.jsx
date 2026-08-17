import { useEffect, useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { recoveryKit } from '../lib/messaging.js';
import { forbiddenFieldsIn } from '../../core/recovery-kit.js';
import { openPrintableKit } from '../lib/printable-kit.js';

/**
 * The recovery kit — a page designed to be printed and then put away.
 *
 * KeyVault has one unrecoverable failure, and it is not disk loss or theft:
 * it is forgetting the master password. Nobody holds a second key. The
 * remedy is old-fashioned and completely effective — write it down, put it
 * somewhere safe — and this page exists to make that a thing people do
 * rather than a thing they mean to do.
 *
 * The master password is deliberately **not** printed, and cannot be: the
 * extension never stores it. There is a ruled box for writing it in by hand.
 * That is not a limitation being dressed up; a printed password passes
 * through a spooler and possibly a shared printer on its way to the drawer.
 */
export function RecoveryKit() {
  const [kit, setKit] = useState(null);
  const [error, setError] = useState(null);

  // Held in this component and nowhere else: never sent to the background,
  // never written to storage, gone the moment the page closes. The only place
  // either value ends up is the sheet the user prints.
  const [masterPassword, setMasterPassword] = useState('');
  const [backupLocation, setBackupLocation] = useState('');
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    recoveryKit()
      .then((result) => {
        // The guarantee is checked here, not merely documented. If something
        // upstream ever adds a secret to this payload, this page refuses to
        // render rather than printing it.
        const leaked = forbiddenFieldsIn(result);
        if (leaked.length > 0) {
          setError(`Refusing to print: the kit contained ${leaked.join(', ')}.`);
          return;
        }
        setKit(result);
      })
      .catch((caught) => setError(caught.message));
  }, []);

  if (error !== null) {
    return (
      <Pane>
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      </Pane>
    );
  }

  return (
    <Pane>
      {/* Only the sheet itself survives printing. Everything else on screen —
          the app chrome, this page's own explanation, the button — is
          furniture for the reader, not for the drawer. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #recovery-sheet, #recovery-sheet * { visibility: visible; }
          #recovery-sheet {
            position: absolute; inset: 0; margin: 0; padding: 32px;
            border: 0; box-shadow: none; background: #fff; color: #000;
          }
          @page { margin: 16mm; }
        }
      `}</style>

      <div className="mb-5 flex items-start justify-between gap-4 print:hidden">
        <p className="max-w-[58ch] text-sm leading-relaxed text-[var(--color-fg-muted)]">
          Print this and put it where you keep documents that matter. It holds nothing worth
          stealing — no password, no key, no entry — so its only job is to tell a future you, or
          somebody sorting out your affairs, what this vault is and how to open it.
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={kit === null}
          onClick={() => {
            // A separate tab, not this page. The popup cannot print at all,
            // and this page is themed — a dark-mode sheet forced onto white
            // paper prints white on white.
            const opened = openPrintableKit(kit, { masterPassword, backupLocation });
            if (!opened) {
              setError('Chrome blocked the print window. Allow pop-ups for this page and retry.');
            }
          }}
        >
          <Icon.Document className="size-4" />
          Print
        </Button>
      </div>

      <article
        id="recovery-sheet"
        className="max-w-[52rem] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-border)] pb-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--color-accent)]">
            <Icon.Shield className="size-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">KeyVault Recovery Kit</h2>
            <p className="text-xs text-[var(--color-fg-muted)]">
              Keep this on paper. Do not photograph it or store it in another password manager.
            </p>
          </div>
        </header>

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            This vault
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <Field label="Vault ID" value={kit?.fingerprint ?? '…'} mono />
            <Field label="Items at printing" value={kit === null ? '…' : String(kit.entryCount)} />
            <Field label="KeyVault version" value={kit?.version ?? '…'} />
            <Field
              label="Printed"
              value={kit === null ? '…' : new Date(kit.generatedAt).toLocaleDateString()}
            />
          </dl>
          <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
            The vault ID identifies which vault a backup file belongs to. It is not a secret and it
            cannot open anything.
          </p>
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Master password
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
            Write it here by hand. KeyVault does not know it and cannot print it — it is never
            stored anywhere, which is the reason nobody can be asked to reset it.
          </p>
          <div className="mt-2 flex gap-2 print:hidden">
            <input
              type={reveal ? 'text' : 'password'}
              value={masterPassword}
              onInput={(event) => setMasterPassword(event.currentTarget.value)}
              placeholder="Type it to print it, or leave blank to write it by hand"
              autoComplete="off"
              spellcheck={false}
              aria-label="Master password to print"
              className="min-w-0 flex-1 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2 font-mono text-sm"
            />
            <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>
              {reveal ? 'Hide' : 'Show'}
            </Button>
          </div>
          {masterPassword.trim() !== '' && (
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-[var(--color-warn)]">
              <Icon.Shield className="mt-px size-4 shrink-0" />
              The printed sheet will then open your vault on its own. It goes through the print
              spooler on the way, so avoid a shared or networked printer, and keep the paper where
              you keep a passport rather than in a desk drawer.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Where the backup file is
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
            A backup is an encrypted file you exported from Settings. Without one, this sheet cannot
            rebuild anything on a new machine — the password alone is not enough.
          </p>
          <div className="mt-2 flex gap-2 print:hidden">
            <input
              type="text"
              value={backupLocation}
              onInput={(event) => setBackupLocation(event.currentTarget.value)}
              placeholder="e.g. Documents/keyvault-backup.json, or the safe it is in"
              autoComplete="off"
              aria-label="Where the backup file is"
              className="min-w-0 flex-1 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2 text-sm"
            />
            <label className="shrink-0">
              {/* The browser gives a chosen file's name but never its folder,
                  so this fills in what it can and the rest is typed. */}
              <input
                type="file"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file !== undefined) {
                    setBackupLocation(file.name);
                  }
                }}
              />
              <span className="inline-flex cursor-pointer items-center rounded-[var(--radius-field)] border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-field)]">
                Choose file
              </span>
            </label>
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            How to get back in
          </h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              Install KeyVault from{' '}
              <span className="font-mono text-xs">github.com/shipiit/keyvault</span> and follow{' '}
              <span className="font-mono text-xs">INSTALL.md</span>.
            </li>
            <li>
              Create a vault. Any password will do at this step; it is replaced by the import.
            </li>
            <li>Open Settings, choose Import, and select the backup file named above.</li>
            <li>Enter the master password written above. Your items come back.</li>
          </ol>
        </section>

        <footer className="mt-6 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
            <strong>If you lose the master password, the items are gone.</strong> Not withheld —
            gone. The vault is encrypted with a key derived from that password, no copy of it
            exists, and no part of this project can recover it. That is the trade for having no
            server that could be compelled or breached.
          </p>
        </footer>
      </article>
    </Pane>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-fg-muted)]">{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono tracking-wider' : ''}`}>{value}</dd>
    </div>
  );
}

function Pane({ children }) {
  return (
    <section
      aria-label="Recovery kit"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight print:hidden">Recovery kit</h1>
      {children}
    </section>
  );
}
