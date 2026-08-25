import { useEffect, useState } from 'preact/hooks';
import { Icon, IconButton } from './primitives.jsx';
import { copyWithAutoClear } from '../lib/messaging.js';
import { describeSshKey } from '../../core/ssh-key.js';

/**
 * A stored SSH key, summarised.
 *
 * The fingerprint is the point. It is the string a server prints on first
 * connection, GitHub lists beside a key, and `ssh-keygen -l` gives — so
 * having it here answers "is this the key that machine expects?" without
 * going to look. It is computed locally from the public half; nothing is
 * sent anywhere and the private key is never parsed beyond its format.
 */
export function SshKeyPanel({ entry }) {
  const [described, setDescribed] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    describeSshKey(entry)
      .then((result) => {
        if (live) {
          setDescribed(result);
        }
      })
      .catch(() => setDescribed(null));
    return () => {
      live = false;
    };
  }, [entry]);

  if (described === null) {
    return null;
  }

  if (described.algorithm === null) {
    return (
      <p className="rounded-[var(--radius-field)] bg-[var(--color-field)] p-3 text-xs leading-relaxed text-[var(--color-fg-muted)]">
        No public key stored, so there is no fingerprint to show. Paste the contents of the matching{' '}
        <code>.pub</code> file into this item to get one.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--color-field)] px-2.5 py-1 text-xs font-semibold">
          {described.algorithm}
        </span>
        {described.comment !== '' && (
          <span className="rounded-full bg-[var(--color-field)] px-2.5 py-1 text-xs text-[var(--color-fg-muted)]">
            {described.comment}
          </span>
        )}
        {described.privateKey !== null && (
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{
              backgroundColor:
                described.privateKey.encrypted === false
                  ? 'color-mix(in srgb, var(--color-warn) 16%, transparent)'
                  : 'var(--color-field)',
              color:
                described.privateKey.encrypted === false
                  ? 'var(--color-warn)'
                  : 'var(--color-fg-muted)',
            }}
          >
            {described.privateKey.format}
            {described.privateKey.encrypted === false && ' · no passphrase'}
          </span>
        )}
      </div>

      {described.warning !== null && (
        <p role="alert" className="text-xs leading-relaxed text-[var(--color-warn)]">
          {described.warning}
        </p>
      )}

      <div className="flex items-center gap-2 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--color-fg-muted)]">Fingerprint</div>
          <div className="truncate font-mono text-sm">{described.fingerprint}</div>
        </div>
        <IconButton
          label="Copy fingerprint"
          onClick={async () => {
            await copyWithAutoClear(described.fingerprint);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Icon.Check className="size-4 text-[var(--color-success)]" />
          ) : (
            <Icon.Copy className="size-4" />
          )}
        </IconButton>
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
        The same string <code>ssh-keygen -lf</code> prints, computed here from the public key.
        Compare it with what a server or a hosting account shows to confirm you are looking at the
        same key.
      </p>
    </section>
  );
}
