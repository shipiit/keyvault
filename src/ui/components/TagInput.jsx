import { useState } from 'preact/hooks';
import { normaliseTags, tagKey } from '../../core/tags.js';

/**
 * Entering tags, with suggestions drawn from tags already in use.
 *
 * Suggestions exist to stop near-duplicates. Left to free text, a vault
 * accumulates `finance` beside `finances` beside `Finance`, and each split
 * makes the grouping less useful than no grouping at all.
 *
 * Committing on comma as well as Enter matters more than it sounds: people
 * type tag lists the way they type any list, and swallowing the comma into
 * the tag name produces `work,` as a tag.
 */
export function TagInput({ tags, suggestions = [], onChange, label = 'Tags' }) {
  const [draft, setDraft] = useState('');

  /**
   * Add one or more tags in a single update.
   *
   * Takes a list rather than one value because adding them one at a time
   * calls `onChange` repeatedly against the same `tags` prop — the parent
   * has not re-rendered yet — so each call overwrites the previous and only
   * the last tag survives. Pasting "alpha,beta" kept only "beta".
   */
  const add = (...values) => {
    // Normalising the whole list is what folds a differently-capitalised
    // duplicate into the one already there.
    const next = normaliseTags([...tags, ...values]);
    setDraft('');
    if (next.length !== tags.length) {
      onChange(next);
    }
  };

  const remove = (tag) => onChange(tags.filter((candidate) => tagKey(candidate) !== tagKey(tag)));

  const unused = suggestions.filter(
    (suggestion) => !tags.some((tag) => tagKey(tag) === tagKey(suggestion)),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[var(--color-fg)]">{label}</span>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-field)] py-1 pl-2.5 pr-1 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => remove(tag)}
              className="grid size-4 place-items-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-fg)]"
            >
              ×
            </button>
          </span>
        ))}

        <input
          value={draft}
          placeholder={tags.length === 0 ? 'e.g. work, finance' : ''}
          aria-label="Add a tag"
          autoComplete="off"
          onInput={(event) => {
            const value = event.currentTarget.value;
            // Typing a comma means "that one is finished", not "put a comma
            // in the tag name".
            if (value.includes(',')) {
              add(...value.split(','));
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Otherwise Enter submits the surrounding form and saves the
              // item while the tag is still half-typed.
              event.preventDefault();
              add(draft);
            }
            if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => add(draft)}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1.5 text-sm outline-none"
        />
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unused.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
