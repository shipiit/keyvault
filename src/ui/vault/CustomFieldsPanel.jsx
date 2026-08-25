import { useState } from 'preact/hooks';
import { Icon, IconButton } from './primitives.jsx';
import { copyWithAutoClear } from '../lib/messaging.js';
import { sectionsOf, isSecretField } from '../../core/custom-fields.js';

/**
 * Custom fields on the item view.
 *
 * Hidden fields are masked until asked for, and revealed one at a time
 * rather than by a single switch over the whole item: revealing everything
 * to read one value is how a shoulder-surfer gets the rest for free.
 *
 * Copying goes through the same auto-clearing clipboard the password uses,
 * so a recovery code does not sit in the clipboard for the rest of the day.
 */
export function CustomFieldsPanel({ entry }) {
  const sections = sectionsOf(entry);
  const [revealed, setRevealed] = useState(() => new Set());
  const [copied, setCopied] = useState(null);

  if (sections.length === 0) {
    return null;
  }

  const toggle = (id) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <section key={section.id}>
          {section.title !== '' && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {section.title}
            </h3>
          )}

          <dl className="flex flex-col gap-2">
            {section.fields.map((field) => {
              const secret = isSecretField(field.type);
              const shown = !secret || revealed.has(field.id);
              return (
                <div
                  key={field.id}
                  className="flex items-center gap-3 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2"
                >
                  <dt className="w-32 shrink-0 truncate text-xs text-[var(--color-fg-muted)]">
                    {field.label === '' ? 'Untitled' : field.label}
                  </dt>

                  <dd
                    className={[
                      'min-w-0 flex-1 break-all text-sm',
                      secret ? 'font-mono' : '',
                      field.type === 'multiline' ? 'whitespace-pre-wrap' : 'truncate',
                    ].join(' ')}
                  >
                    {shown ? renderValue(field) : '•'.repeat(12)}
                  </dd>

                  {secret && (
                    <IconButton
                      label={`${shown ? 'Hide' : 'Show'} ${field.label || 'field'}`}
                      aria-pressed={shown}
                      onClick={() => toggle(field.id)}
                    >
                      {shown ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
                    </IconButton>
                  )}

                  {field.value !== '' && (
                    <IconButton
                      label={`Copy ${field.label || 'field'}`}
                      onClick={async () => {
                        await copyWithAutoClear(field.value);
                        setCopied(field.id);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                    >
                      {copied === field.id ? (
                        <Icon.Check className="size-4 text-[var(--color-success)]" />
                      ) : (
                        <Icon.Copy className="size-4" />
                      )}
                    </IconButton>
                  )}
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

function renderValue(field) {
  if (field.value === '') {
    return <span className="text-[var(--color-fg-subtle)]">Empty</span>;
  }
  if (field.type === 'url') {
    return (
      <a
        href={field.value}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[var(--color-accent)] hover:underline"
      >
        {field.value}
      </a>
    );
  }
  if (field.type === 'date') {
    const parsed = Number.isNaN(Date.parse(field.value)) ? null : new Date(field.value);
    return parsed === null ? field.value : parsed.toLocaleDateString();
  }
  return field.value;
}
