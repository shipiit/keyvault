import { describe, it, expect } from 'vitest';
import {
  createField,
  createSection,
  sectionsOf,
  pruneSections,
  redactSections,
  searchableText,
  countFields,
  isSecretField,
  FIELD_TYPES,
} from '../../src/core/custom-fields.js';

const SECRET = 'ABCD-1234-EFGH-5678';

const entry = () => ({
  fields: {
    sections: [
      {
        title: 'Recovery',
        fields: [
          { label: 'Backup code', type: 'concealed', value: SECRET },
          { label: 'Support PIN', type: 'text', value: '4417' },
        ],
      },
    ],
  },
});

describe('createField', () => {
  it('gives every field a stable id', () => {
    // Without one, reordering or editing a list rewrites the wrong row.
    const field = createField({ label: 'x' });
    expect(field.id).toMatch(/[0-9a-f-]{8,}/);
    expect(createField({ id: 'kept' }).id).toBe('kept');
  });

  it('falls back to text for a type it does not know', () => {
    // An import from another manager carries types this does not have.
    // Losing the value would be worse than losing the type.
    const field = createField({ label: 'x', type: 'wallet-address', value: 'abc' });
    expect(field.type).toBe('text');
    expect(field.value).toBe('abc');
  });

  it('does not throw on junk', () => {
    for (const value of [null, undefined, 42, 'text', []]) {
      expect(() => createField(value)).not.toThrow();
    }
  });
});

describe('isSecretField', () => {
  it('treats concealed as the only secret type', () => {
    expect(isSecretField('concealed')).toBe(true);
    for (const type of FIELD_TYPES.filter((t) => t.id !== 'concealed')) {
      expect(isSecretField(type.id), type.id).toBe(false);
    }
  });

  it('is false for an unknown type rather than defaulting to secret', () => {
    // Defaulting the other way sounds safer and is not: it would silently
    // hide values people expected to see, and they would stop trusting it.
    expect(isSecretField('nonsense')).toBe(false);
  });
});

describe('sectionsOf', () => {
  it('reads what is stored', () => {
    expect(sectionsOf(entry())[0].title).toBe('Recovery');
    expect(sectionsOf(entry())[0].fields).toHaveLength(2);
  });

  it('returns an empty list for an entry with none', () => {
    for (const value of [{}, { fields: {} }, { fields: { sections: 'nope' } }, null]) {
      expect(sectionsOf(value)).toEqual([]);
    }
  });
});

describe('pruneSections', () => {
  it('drops a row nobody filled in', () => {
    // Otherwise it reappears on every edit, forever.
    const pruned = pruneSections([
      {
        title: 'Kept',
        fields: [
          { label: 'a', value: '1' },
          { label: '', value: '' },
        ],
      },
    ]);
    expect(pruned[0].fields).toHaveLength(1);
  });

  it('keeps a field with a value but no label', () => {
    expect(
      pruneSections([{ title: 's', fields: [{ label: '', value: 'x' }] }])[0].fields,
    ).toHaveLength(1);
  });

  it('drops a section left completely empty', () => {
    expect(pruneSections([{ title: '', fields: [] }])).toEqual([]);
  });
});

describe('redactSections', () => {
  it('removes secret values and keeps everything else', () => {
    const redacted = redactSections(sectionsOf(entry()));
    const [secret, plain] = redacted[0].fields;
    expect(secret.value).toBe('');
    expect(secret.redacted).toBe(true);
    expect(plain.value).toBe('4417');
  });

  it('keeps the label of a secret field', () => {
    // Knowing an item has a recovery code is not knowing the code, and
    // hiding the label would make the item look emptier than it is.
    expect(redactSections(sectionsOf(entry()))[0].fields[0].label).toBe('Backup code');
  });

  it('leaves no trace of the secret anywhere in its output', () => {
    expect(JSON.stringify(redactSections(sectionsOf(entry())))).not.toContain(SECRET);
  });
});

describe('searchableText', () => {
  it('indexes labels and ordinary values', () => {
    const text = searchableText(entry());
    expect(text).toContain('Recovery');
    expect(text).toContain('Backup code');
    expect(text).toContain('4417');
  });

  it('never indexes the value of a hidden field', () => {
    // A search index holding the secret in the clear would let a typed query
    // confirm it a character at a time.
    expect(searchableText(entry())).not.toContain(SECRET);
  });

  it('returns an empty string for an entry with no custom fields', () => {
    expect(searchableText({})).toBe('');
  });
});

describe('countFields', () => {
  it('counts fields and secrets separately', () => {
    expect(countFields(entry())).toEqual({ sections: 1, fields: 2, secrets: 1 });
  });

  it('is all zeroes for an entry with none', () => {
    expect(countFields({})).toEqual({ sections: 0, fields: 0, secrets: 0 });
  });
});

describe('createSection', () => {
  it('normalises nested fields too', () => {
    const section = createSection({ title: ' Trimmed ', fields: [{ label: ' a ' }] });
    expect(section.title).toBe('Trimmed');
    expect(section.fields[0].label).toBe('a');
  });
});
