import { Icon, IconButton } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { createField, createSection, FIELD_TYPES } from '../../core/custom-fields.js';

/**
 * Editing the custom sections on an item.
 *
 * Everything that does not fit the built-in boxes goes here — recovery codes,
 * account numbers, security questions, the PIN a bank asks for. Without it
 * all of that ends up in the notes field, where nothing can mask it, copy it
 * cleanly, or keep it out of a search index.
 *
 * The type selector is the load-bearing control: choosing **Hidden** is what
 * makes a value a secret everywhere else — masked on the item, absent from
 * search, stripped before the item crosses into any less trusted context.
 * It is offered per field rather than guessed from the label, because a
 * guess that is wrong in the unsafe direction is silent.
 */
export function CustomFieldsEditor({ sections, onChange }) {
  const update = (sectionId, changer) =>
    onChange(sections.map((section) => (section.id === sectionId ? changer(section) : section)));

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <fieldset
          key={section.id}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
        >
          <legend className="sr-only">Custom section</legend>

          <div className="mb-2 flex items-center gap-2">
            <input
              value={section.title}
              placeholder="Section name (optional)"
              aria-label="Section name"
              onInput={(event) =>
                update(section.id, (s) => ({ ...s, title: event.currentTarget.value }))
              }
              className="h-9 min-w-0 flex-1 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 text-sm font-medium"
            />
            <IconButton
              label="Remove section"
              onClick={() => onChange(sections.filter((s) => s.id !== section.id))}
            >
              <Icon.Trash className="size-4" />
            </IconButton>
          </div>

          <div className="flex flex-col gap-2">
            {section.fields.map((field) => (
              <div key={field.id} className="flex flex-wrap items-center gap-2">
                <input
                  value={field.label}
                  placeholder="Label"
                  aria-label="Field label"
                  onInput={(event) =>
                    update(section.id, (s) => ({
                      ...s,
                      fields: s.fields.map((f) =>
                        f.id === field.id ? { ...f, label: event.currentTarget.value } : f,
                      ),
                    }))
                  }
                  className="h-9 w-32 shrink-0 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 text-sm"
                />

                <input
                  // Hidden fields are masked while typing too. Somebody adding
                  // a recovery code at a desk is exactly who this is for.
                  type={field.type === 'concealed' ? 'password' : 'text'}
                  value={field.value}
                  placeholder="Value"
                  aria-label="Field value"
                  autoComplete="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                  onInput={(event) =>
                    update(section.id, (s) => ({
                      ...s,
                      fields: s.fields.map((f) =>
                        f.id === field.id ? { ...f, value: event.currentTarget.value } : f,
                      ),
                    }))
                  }
                  className={[
                    'h-9 min-w-0 flex-1 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 text-sm',
                    field.type === 'concealed' ? 'font-mono' : '',
                  ].join(' ')}
                />

                <select
                  value={field.type}
                  aria-label="Field type"
                  onChange={(event) =>
                    update(section.id, (s) => ({
                      ...s,
                      fields: s.fields.map((f) =>
                        f.id === field.id ? { ...f, type: event.currentTarget.value } : f,
                      ),
                    }))
                  }
                  className="h-9 shrink-0 rounded-[var(--radius-field)] bg-[var(--color-field)] px-2 text-xs"
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <IconButton
                  label={`Remove ${field.label === '' ? 'field' : field.label}`}
                  onClick={() =>
                    update(section.id, (s) => ({
                      ...s,
                      fields: s.fields.filter((f) => f.id !== field.id),
                    }))
                  }
                >
                  <Icon.Close className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() =>
              update(section.id, (s) => ({ ...s, fields: [...s.fields, createField()] }))
            }
          >
            Add field
          </Button>
        </fieldset>
      ))}

      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => onChange([...sections, createSection({ fields: [createField()] })])}
      >
        Add section
      </Button>
    </div>
  );
}
