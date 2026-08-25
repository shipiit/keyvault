/**
 * Custom fields, grouped into sections.
 *
 * The shape follows 1Password: an item carries named sections, each holding
 * labelled fields with a type. It is the feature that stops a password
 * manager being a form with five boxes — recovery codes, account numbers,
 * security questions, the PIN a bank asks for, the licence key that came with
 * the software. All of it otherwise ends up crammed into the notes box, where
 * nothing can mask it, copy it cleanly, or leave it out of a projection.
 *
 * The type matters for exactly one reason worth having: `concealed` fields
 * are secrets, and everything downstream keys off that. They are masked in
 * the UI, excluded from search, and stripped by `redactSections` before an
 * item goes anywhere that is not fully trusted. A field is a secret because
 * it says so, not because of what its label happens to be called.
 */

import { randomId } from './random.js';

/** Field kinds. `concealed` is the one with security meaning. */
export const FIELD_TYPES = Object.freeze([
  { id: 'text', label: 'Text' },
  { id: 'concealed', label: 'Hidden', secret: true },
  { id: 'multiline', label: 'Multi-line text' },
  { id: 'url', label: 'Website' },
  { id: 'email', label: 'Email' },
  { id: 'date', label: 'Date' },
]);

const TYPE_IDS = FIELD_TYPES.map((t) => t.id);

/** @param {string} type */
export function isSecretField(type) {
  return FIELD_TYPES.find((t) => t.id === type)?.secret === true;
}

/**
 * @param {object} [field]
 * @returns {{id: string, label: string, type: string, value: string}}
 */
export function createField(input = {}) {
  // A default parameter only covers `undefined`, and this parses data that
  // may have come from an importer or a hand-edited backup, where null and
  // a bare string both turn up.
  const field = input !== null && typeof input === 'object' ? input : {};
  return {
    id: typeof field.id === 'string' && field.id !== '' ? field.id : randomId(),
    label: typeof field.label === 'string' ? field.label.trim() : '',
    // Anything unrecognised becomes text rather than throwing. An import from
    // another manager will carry types this does not have, and losing the
    // value would be worse than losing the type.
    type: TYPE_IDS.includes(field.type) ? field.type : 'text',
    value: typeof field.value === 'string' ? field.value : '',
  };
}

/**
 * @param {object} [section]
 * @returns {{id: string, title: string, fields: object[]}}
 */
export function createSection(input = {}) {
  const section = input !== null && typeof input === 'object' ? input : {};
  return {
    id: typeof section.id === 'string' && section.id !== '' ? section.id : randomId(),
    title: typeof section.title === 'string' ? section.title.trim() : '',
    fields: Array.isArray(section.fields) ? section.fields.map(createField) : [],
  };
}

/**
 * Read whatever is stored on an entry into a known shape.
 *
 * Tolerant on purpose: this runs over data that may have come from an
 * importer, an older version of this program, or a hand-edited backup.
 *
 * @param {object} entry
 * @returns {object[]}
 */
export function sectionsOf(entry) {
  const raw = entry?.fields?.sections;
  return Array.isArray(raw) ? raw.map(createSection) : [];
}

/**
 * Drop empty sections and empty fields.
 *
 * A field with no label and no value is a row somebody added and did not
 * fill; keeping it would mean it reappears on every edit forever.
 *
 * @param {object[]} sections
 * @returns {object[]}
 */
export function pruneSections(sections) {
  return (sections ?? [])
    .map((section) => ({
      ...createSection(section),
      fields: (section.fields ?? [])
        .map(createField)
        .filter((field) => field.label !== '' || field.value !== ''),
    }))
    .filter((section) => section.title !== '' || section.fields.length > 0);
}

/**
 * The same sections with every secret value removed.
 *
 * Used anywhere an item crosses into a less trusted context, or is rendered
 * in bulk. The labels stay — knowing an item *has* a recovery code is not
 * the same as knowing the code, and hiding the label would make the item
 * look emptier than it is.
 *
 * @param {object[]} sections
 * @returns {object[]}
 */
export function redactSections(sections) {
  return (sections ?? []).map((section) => ({
    ...createSection(section),
    fields: (section.fields ?? []).map((field) => {
      const normalised = createField(field);
      return isSecretField(normalised.type)
        ? { ...normalised, value: '', redacted: true }
        : normalised;
    }),
  }));
}

/**
 * Text from custom fields that is safe to index for search.
 *
 * Labels always; values only when the field is not a secret. Searching by
 * the value of a hidden field would mean the search index holds the secret
 * in the clear, and a typed query could confirm it a character at a time.
 *
 * @param {object} entry
 * @returns {string}
 */
export function searchableText(entry) {
  const parts = [];
  for (const section of sectionsOf(entry)) {
    if (section.title !== '') {
      parts.push(section.title);
    }
    for (const field of section.fields) {
      if (field.label !== '') {
        parts.push(field.label);
      }
      if (!isSecretField(field.type) && field.value !== '') {
        parts.push(field.value);
      }
    }
  }
  return parts.join('\n');
}

/**
 * How many custom fields an entry carries, and how many are secret.
 *
 * @param {object} entry
 * @returns {{fields: number, secrets: number, sections: number}}
 */
export function countFields(entry) {
  const sections = sectionsOf(entry);
  let fields = 0;
  let secrets = 0;
  for (const section of sections) {
    for (const field of section.fields) {
      fields += 1;
      if (isSecretField(field.type)) {
        secrets += 1;
      }
    }
  }
  return { sections: sections.length, fields, secrets };
}
