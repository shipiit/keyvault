import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { Field } from '../components/Field.jsx';
import { Select } from '../components/Select.jsx';
import { CustomFieldsEditor } from './CustomFieldsEditor.jsx';
import { TagInput } from '../components/TagInput.jsx';
import { normaliseTags } from '../../core/tags.js';
import { sectionsOf, pruneSections } from '../../core/custom-fields.js';
import { CREDENTIAL_TYPES, ENVIRONMENTS } from '../../core/api-credential.js';
import { describeCard, formatNumber } from '../../core/card.js';
import { GeneratorPopover } from './GeneratorPopover.jsx';
import { assessPassword } from '../../core/password-strength.js';
import { parseTotpInput } from '../../core/totp.js';
import { scanOpenTabsForTotp } from '../lib/messaging.js';

/** One line each, so the chooser explains itself rather than relying on icons. */
/** The password field is the vault's masked field; each type uses it for something. */
const PASSWORD_LABEL = {
  login: 'Password',
  apiKey: 'Key or token',
  sshKey: 'Private key',
  card: 'Security code (CVV)',
  note: 'Hidden note',
  identity: 'Identifying number',
  document: 'Hidden note',
};

const TYPE_HINTS = {
  login: 'A website username and password',
  apiKey: 'A key or token, with its environment and expiry',
  sshKey: 'A key pair, with the fingerprint derived from it',
  note: 'Free text, encrypted like everything else',
  card: 'A payment card, with the issuer read from the number',
  identity: 'Personal details for filling long forms',
  document: 'A record of a document you hold elsewhere',
};

const TYPES = [
  { id: 'login', label: 'Login', icon: Icon.Lock },
  { id: 'apiKey', label: 'API Key', icon: Icon.Key },
  { id: 'sshKey', label: 'SSH Key', icon: Icon.Terminal },
  { id: 'note', label: 'Secure Note', icon: Icon.Note },
  { id: 'card', label: 'Card', icon: Icon.Card },
  { id: 'identity', label: 'Identity', icon: Icon.Identity },
  { id: 'document', label: 'Document', icon: Icon.Document },
];

/**
 * Epoch milliseconds to the YYYY-MM-DD an <input type="date"> expects.
 *
 * Built from the local calendar date rather than toISOString(), which
 * converts to UTC first and lands on the previous day for anyone west of
 * Greenwich for part of their day.
 */
function toDateInput(value) {
  if (typeof value !== 'number') {
    return '';
  }
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** And back again. Midday local, so a timezone shift cannot move the date. */
function fromDateInput(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

const EMPTY = {
  title: '',
  card: { cardholder: '', number: '', expiryMonth: '', expiryYear: '', pin: '' },
  identity: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    street: '',
    city: '',
    postcode: '',
    country: '',
  },
  document: { reference: '', issuer: '', issued: '', expires: '', location: '' },
  publicKey: '',
  tags: [],
  sections: [],
  credentialType: 'apiKey',
  environment: 'unknown',
  hostname: '',
  validFrom: '',
  expires: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totpUri: '',
  autoSubmit: false,
};

/**
 * Right-hand drawer for creating and editing an item.
 *
 * Used for both, because the fields are identical and two near-copies of a
 * form is where they drift apart.
 */
export function ItemDrawer({
  entry = null,
  onSave,
  onClose,
  compact = false,
  tagSuggestions = [],
}) {
  const isEdit = entry !== null;
  const [type, setType] = useState('login');
  // Two steps for a new item: choose what it is, then fill it in. Editing
  // skips straight to the fields, because the type is already settled.
  const [step, setStep] = useState(entry === null ? 'type' : 'fields');
  const [values, setValues] = useState(EMPTY);
  const activeType = TYPES.find((option) => option.id === type) ?? TYPES[0];
  const [showTotp, setShowTotp] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [scan, setScan] = useState({ status: 'idle' });
  const panelRef = useRef(null);

  useEffect(() => {
    if (entry === null) {
      setValues(EMPTY);
      setShowTotp(false);
      return;
    }
    setType(entry.type ?? 'login');
    setStep('fields');
    const credential = entry.fields?.credential ?? {};
    setValues({
      title: entry.title ?? '',
      sections: sectionsOf(entry),
      publicKey: entry.fields?.ssh?.publicKey ?? '',
      card: { ...EMPTY.card, ...(entry.fields?.card ?? {}) },
      identity: { ...EMPTY.identity, ...(entry.fields?.identity ?? {}) },
      document: { ...EMPTY.document, ...(entry.fields?.document ?? {}) },
      tags: normaliseTags(entry.tags),
      credentialType: credential.credentialType ?? 'apiKey',
      environment: credential.environment ?? 'unknown',
      hostname: credential.hostname ?? '',
      // <input type="date"> speaks YYYY-MM-DD; the vault stores epoch ms.
      validFrom: toDateInput(credential.validFrom),
      expires: toDateInput(credential.expires),
      username: entry.username ?? '',
      password: entry.password ?? '',
      url: entry.urls?.[0] ?? '',
      notes: entry.notes ?? '',
      totpUri: '',
      autoSubmit: entry.autoSubmit === true,
    });
    setShowTotp(entry.totp !== null && entry.totp !== undefined);
  }, [entry]);

  // Escape closes, and focus returns to whatever opened the drawer.
  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    // preventScroll: without it the browser scrolls the focused field to the
    // top of the pane, hiding the item-type selector and the Title label
    // above it the moment the drawer opens.
    panelRef.current?.querySelector('input')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const set = (key) => (event) =>
    setValues((current) => ({ ...current, [key]: event.currentTarget.value }));

  // Select hands over the value itself, not an event. Reusing `set` here
  // silently stored `undefined` and the field kept its default — the form
  // looked right on screen and saved the wrong thing.
  const setValue = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));

  /** Update one field inside a nested group such as `card` or `identity`. */
  const setIn = (group, key) => (event) =>
    setValues((current) => ({
      ...current,
      [group]: { ...current[group], [key]: event.currentTarget.value },
    }));

  const strength = values.password === '' ? null : assessPassword(values.password);

  function validate() {
    const found = {};
    if (values.title.trim() === '') {
      found.title = 'A title is required';
    }
    if (values.totpUri.trim() !== '') {
      try {
        // Accepts a full otpauth:// link or the bare setup key. Validated
        // here so a bad key fails while the user is looking at it, not
        // later when they need the code.
        parseTotpInput(values.totpUri, { title: values.title });
      } catch (error) {
        found.totpUri = error.message;
      }
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate() || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...values,
        type,
        tags: normaliseTags(values.tags),
        // One object, built once. `fields` is where the entry model keeps
        // per-type data; assigning it twice — once for the credential, once
        // for the sections — would have the second overwrite the first and
        // silently drop whichever was assembled earlier.
        fields: {
          sections: pruneSections(values.sections),
          ...(type === 'sshKey' ? { ssh: { publicKey: values.publicKey.trim() } } : {}),
          ...(type === 'card' ? { card: values.card } : {}),
          ...(type === 'identity' ? { identity: values.identity } : {}),
          ...(type === 'document' ? { document: values.document } : {}),
          ...(type === 'apiKey'
            ? {
                credential: {
                  credentialType: values.credentialType,
                  environment: values.environment,
                  hostname: values.hostname.trim(),
                  validFrom: fromDateInput(values.validFrom),
                  expires: fromDateInput(values.expires),
                },
              }
            : {}),
        },
      });
    } catch (error) {
      setErrors({ form: error.message });
      setSaving(false);
    }
  }

  return (
    <div
      // Full screen rather than a 380px rail. Cards and identities have a
      // dozen fields each; in a narrow column they became a scroll with the
      // save button always just out of sight.
      className={[
        'fixed inset-0 z-50 flex items-center justify-center',
        compact ? 'p-0' : 'p-4 sm:p-8',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[var(--color-ink)]/45 backdrop-blur-[2px]"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-label={isEdit ? 'Edit item' : 'New item'}
        aria-modal="true"
        className={[
          'relative flex max-h-full w-full flex-col overflow-hidden bg-[var(--color-chrome)]',
          'border border-[var(--color-border)] shadow-2xl',
          compact ? 'h-full' : 'max-w-3xl rounded-[var(--radius-card)]',
        ].join(' ')}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-6 pb-4 pt-5">
          <div className="flex items-center gap-3">
            {step === 'fields' && !isEdit && (
              <IconButton label="Back to item types" onClick={() => setStep('type')}>
                <Icon.Chevron className="size-4 rotate-90" />
              </IconButton>
            )}
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {isEdit
                  ? 'Edit item'
                  : step === 'type'
                    ? 'What are you saving?'
                    : `New ${activeType.label.toLowerCase()}`}
              </h2>
              {step === 'type' && !isEdit && (
                <p className="text-xs text-[var(--color-fg-muted)]">
                  Pick a type and the form will ask for what that type actually needs.
                </p>
              )}
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <Icon.Close />
          </IconButton>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {step === 'type' && !isEdit ? (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                role="radiogroup"
                aria-label="Item type"
              >
                {TYPES.map((option) => {
                  const IconComponent = option.icon;
                  const active = type === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setType(option.id);
                        setStep('fields');
                      }}
                      className={[
                        'flex flex-col items-start gap-2 rounded-[var(--radius-card)] p-4 text-left',
                        'border transition-colors duration-[var(--dur-150)]',
                        active
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-field)]',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                        'focus-visible:outline-[var(--color-ring)]',
                      ].join(' ')}
                    >
                      <span className="grid size-9 place-items-center rounded-[var(--radius-field)] bg-[var(--color-field)]">
                        <IconComponent className="size-5 text-[var(--color-fg-muted)]" />
                      </span>
                      <span className="text-sm font-semibold">{option.label}</span>
                      <span className="text-xs leading-snug text-[var(--color-fg-muted)]">
                        {TYPE_HINTS[option.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === 'fields' && (
              <>
                <div className="flex flex-col gap-4">
                  <Field
                    label="Title"
                    required
                    value={values.title}
                    placeholder="e.g. GitHub"
                    error={errors.title ?? null}
                    onInput={set('title')}
                  />

                  {type === 'login' && (
                    <Field
                      label="Username or email"
                      value={values.username}
                      placeholder="e.g. you@example.com"
                      autoComplete="off"
                      onInput={set('username')}
                    />
                  )}

                  {type === 'sshKey' && (
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="drawer-public-key"
                        className="text-sm font-medium text-[var(--color-fg)]"
                      >
                        Public key
                      </label>
                      <textarea
                        id="drawer-public-key"
                        rows={3}
                        value={values.publicKey}
                        placeholder="ssh-ed25519 AAAAC3... you@machine"
                        spellcheck={false}
                        onInput={set('publicKey')}
                        className={[
                          'w-full rounded-[var(--radius-field)] px-3 py-2 font-mono text-xs',
                          'bg-[var(--color-surface)] text-[var(--color-fg)]',
                          'border border-[var(--color-border-strong)]',
                        ].join(' ')}
                      />
                      <p className="text-xs text-[var(--color-fg-subtle)]">
                        Not a secret — it is the half you hand out. Storing it here is what lets
                        KeyVault show the fingerprint a server will ask you to confirm. The private
                        key goes in the field above.
                      </p>
                    </div>
                  )}

                  {type === 'card' && (
                    <>
                      <Field
                        label="Cardholder name"
                        value={values.card.cardholder}
                        placeholder="As printed on the card"
                        autoComplete="off"
                        onInput={setIn('card', 'cardholder')}
                      />

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="card-number" className="text-sm font-medium">
                          Card number
                        </label>
                        <input
                          id="card-number"
                          value={values.card.number}
                          placeholder="0000 0000 0000 0000"
                          inputMode="numeric"
                          autoComplete="off"
                          data-1p-ignore=""
                          data-lpignore="true"
                          // Grouped as it is printed, so it can be checked against
                          // the card in your hand rather than read digit by digit.
                          onInput={(event) =>
                            setValues((current) => ({
                              ...current,
                              card: {
                                ...current.card,
                                number: formatNumber(event.currentTarget.value),
                              },
                            }))
                          }
                          className="h-10 w-full rounded-[var(--radius-field)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 font-mono text-sm"
                        />
                        {(() => {
                          const described = describeCard(values.card);
                          if (described.valid === null) {
                            return null;
                          }
                          return (
                            <p
                              className="text-xs"
                              style={{
                                color: described.valid
                                  ? 'var(--color-fg-muted)'
                                  : 'var(--color-warn)',
                              }}
                            >
                              {described.brand !== null && `${described.brand} · `}
                              {described.valid
                                ? 'checksum looks right'
                                : 'that number fails its checksum — check for a mistyped digit'}
                            </p>
                          );
                        })()}
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <Field
                          label="Expiry month"
                          value={values.card.expiryMonth}
                          placeholder="MM"
                          inputMode="numeric"
                          onInput={setIn('card', 'expiryMonth')}
                        />
                        <Field
                          label="Expiry year"
                          value={values.card.expiryYear}
                          placeholder="YYYY"
                          inputMode="numeric"
                          onInput={setIn('card', 'expiryYear')}
                        />
                        <Field
                          label="PIN"
                          type="password"
                          value={values.card.pin}
                          autoComplete="off"
                          onInput={setIn('card', 'pin')}
                        />
                      </div>

                      <p className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
                        The security code goes in the password field above, which is the one that
                        stays masked and copies with an auto-clearing clipboard.
                      </p>
                    </>
                  )}

                  {type === 'identity' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="First name"
                          value={values.identity.firstName}
                          onInput={setIn('identity', 'firstName')}
                        />
                        <Field
                          label="Last name"
                          value={values.identity.lastName}
                          onInput={setIn('identity', 'lastName')}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="Email"
                          type="email"
                          value={values.identity.email}
                          onInput={setIn('identity', 'email')}
                        />
                        <Field
                          label="Phone"
                          value={values.identity.phone}
                          onInput={setIn('identity', 'phone')}
                        />
                      </div>
                      <Field
                        label="Street"
                        value={values.identity.street}
                        onInput={setIn('identity', 'street')}
                      />
                      <div className="grid grid-cols-3 gap-3">
                        <Field
                          label="City"
                          value={values.identity.city}
                          onInput={setIn('identity', 'city')}
                        />
                        <Field
                          label="Postcode"
                          value={values.identity.postcode}
                          onInput={setIn('identity', 'postcode')}
                        />
                        <Field
                          label="Country"
                          value={values.identity.country}
                          onInput={setIn('identity', 'country')}
                        />
                      </div>
                    </>
                  )}

                  {type === 'document' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="Reference number"
                          value={values.document.reference}
                          placeholder="Passport or licence number"
                          onInput={setIn('document', 'reference')}
                        />
                        <Field
                          label="Issued by"
                          value={values.document.issuer}
                          onInput={setIn('document', 'issuer')}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="Issued"
                          type="date"
                          value={values.document.issued}
                          onInput={setIn('document', 'issued')}
                        />
                        <Field
                          label="Expires"
                          type="date"
                          value={values.document.expires}
                          onInput={setIn('document', 'expires')}
                        />
                      </div>
                      <Field
                        label="Where the document is kept"
                        value={values.document.location}
                        placeholder="e.g. filing cabinet, safe, with a solicitor"
                        onInput={setIn('document', 'location')}
                      />
                      <p className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
                        KeyVault records what a document is and where it lives; it does not store
                        the file itself. Keeping a scan of a passport in a browser extension is a
                        worse idea than it first sounds.
                      </p>
                    </>
                  )}

                  {type === 'apiKey' && (
                    <>
                      <Field
                        label="Username or client ID"
                        value={values.username}
                        placeholder="Optional — some APIs pair a key with an ID"
                        autoComplete="off"
                        onInput={set('username')}
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <Select
                          label="Type"
                          value={values.credentialType}
                          onChange={setValue('credentialType')}
                          options={CREDENTIAL_TYPES}
                        />
                        <Select
                          label="Environment"
                          value={values.environment}
                          onChange={setValue('environment')}
                          options={ENVIRONMENTS}
                        />
                      </div>

                      <Field
                        label="Hostname"
                        value={values.hostname}
                        placeholder="e.g. api.stripe.com"
                        autoComplete="off"
                        onInput={set('hostname')}
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="Valid from"
                          type="date"
                          value={values.validFrom}
                          onInput={set('validFrom')}
                        />
                        <Field
                          label="Expires"
                          type="date"
                          value={values.expires}
                          onInput={set('expires')}
                        />
                      </div>
                    </>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="drawer-password"
                      className="text-sm font-medium text-[var(--color-fg)]"
                    >
                      {PASSWORD_LABEL[type] ?? 'Password'}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          id="drawer-password"
                          type={revealed ? 'text' : 'password'}
                          value={values.password}
                          placeholder="Enter or generate"
                          autoComplete="off"
                          data-1p-ignore=""
                          data-lpignore="true"
                          onInput={set('password')}
                          className={[
                            'h-10 w-full rounded-[var(--radius-field)] pl-3 pr-10 font-mono text-sm',
                            'bg-[var(--color-surface)] text-[var(--color-fg)]',
                            'border border-[var(--color-border-strong)]',
                            'transition-colors duration-[var(--dur-150)]',
                            'hover:border-[var(--color-fg-subtle)]',
                          ].join(' ')}
                        />
                        <IconButton
                          label={revealed ? 'Hide password' : 'Show password'}
                          aria-pressed={revealed}
                          onClick={() => setRevealed((current) => !current)}
                          className="absolute right-0.5 top-0.5 size-9"
                        >
                          {revealed ? <Icon.EyeOff /> : <Icon.Eye />}
                        </IconButton>
                      </div>
                      <GeneratorPopover
                        onUse={(generated) =>
                          setValues((current) => ({ ...current, password: generated }))
                        }
                      />
                    </div>

                    {strength !== null && (
                      <div className="flex items-center gap-2">
                        <div className="flex h-1 flex-1 gap-1" aria-hidden="true">
                          {[0, 1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="h-full flex-1 rounded-full transition-colors duration-[var(--dur-200)]"
                              style={{
                                backgroundColor:
                                  i < strength.score
                                    ? [
                                        'var(--color-danger)',
                                        'var(--color-danger)',
                                        'var(--color-warn)',
                                        'var(--color-success)',
                                        'var(--color-success)',
                                      ][strength.score]
                                    : 'var(--color-border)',
                              }}
                            />
                          ))}
                        </div>
                        <span
                          className="text-xs font-medium text-[var(--color-fg-muted)]"
                          aria-live="polite"
                        >
                          {strength.label}
                        </span>
                      </div>
                    )}
                  </div>

                  <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
                    <span className="text-sm font-medium">Two-factor code (TOTP)</span>
                    <Toggle
                      checked={showTotp}
                      onChange={setShowTotp}
                      label="Enable two-factor code"
                    />
                  </label>

                  {showTotp && (
                    <div className="flex flex-col gap-2">
                      <Field
                        label="Setup key or otpauth:// URI"
                        value={values.totpUri}
                        placeholder="otpauth://totp/… or the secret"
                        error={errors.totpUri ?? null}
                        onInput={set('totpUri')}
                      />

                      <Button
                        variant="secondary"
                        size="sm"
                        loading={scan.status === 'scanning'}
                        onClick={async () => {
                          setScan({ status: 'scanning' });
                          const result = await scanOpenTabsForTotp();
                          if (result.found) {
                            setValues((current) => ({
                              ...current,
                              totpUri: result.uri ?? result.secret,
                            }));
                            setErrors((current) => ({ ...current, totpUri: undefined }));
                            setScan({ status: 'found', source: result.source });
                          } else {
                            setScan({ status: 'failed', reason: result.reason });
                          }
                        }}
                      >
                        <Icon.Search className="size-4" />
                        Scan open tabs for a QR code
                      </Button>

                      <p
                        className={[
                          'text-xs leading-relaxed',
                          scan.status === 'failed'
                            ? 'text-[var(--color-warn)]'
                            : 'text-[var(--color-fg-muted)]',
                        ].join(' ')}
                        aria-live="polite"
                      >
                        {scan.status === 'found'
                          ? scan.source === 'image'
                            ? 'Found — read from the QR image on the page.'
                            : 'Found — read from the setup key printed on the page.'
                          : scan.status === 'failed'
                            ? scan.reason
                            : 'Open the two-factor setup page in another tab, then scan — or paste ' +
                              'the key yourself.'}
                      </p>
                    </div>
                  )}

                  <Field
                    label="Website"
                    value={values.url}
                    placeholder="https://example.com"
                    autoComplete="off"
                    onInput={set('url')}
                  />

                  <div className="flex flex-col gap-1.5">
                    <TagInput
                      tags={values.tags}
                      suggestions={tagSuggestions}
                      onChange={(tags) => setValues((current) => ({ ...current, tags }))}
                    />

                    {/* Above the notes box on purpose: it is the field these exist to
                  empty, and offering the structured option first is what stops a
                  recovery code being pasted into free text. */}
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-[var(--color-fg)]">
                        Custom fields
                      </span>
                      <CustomFieldsEditor
                        sections={values.sections}
                        onChange={(sections) => setValues((current) => ({ ...current, sections }))}
                      />
                    </div>

                    <label
                      htmlFor="drawer-notes"
                      className="text-sm font-medium text-[var(--color-fg)]"
                    >
                      Notes
                    </label>
                    <textarea
                      id="drawer-notes"
                      rows="3"
                      value={values.notes}
                      placeholder="Anything worth remembering"
                      onInput={set('notes')}
                      className={[
                        'w-full resize-y rounded-[var(--radius-field)] p-3 text-sm',
                        'bg-[var(--color-surface)] text-[var(--color-fg)]',
                        'placeholder:text-[var(--color-fg-subtle)]',
                        'border border-[var(--color-border-strong)]',
                        'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-fg-subtle)]',
                      ].join(' ')}
                    />
                  </div>

                  <label className="flex cursor-pointer items-start justify-between gap-3 rounded-[var(--radius-field)] border border-[var(--color-border)] p-3">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Sign in automatically</span>
                      {/* The risk is stated at the point of decision, not buried in
                    settings — this is the one toggle that can hand a
                    credential to a look-alike site. */}
                      <span className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
                        Submits the form after filling. Leave off unless you trust this site — a
                        look-alike domain could capture the login before you notice.
                      </span>
                    </span>
                    <Toggle
                      checked={values.autoSubmit}
                      onChange={(next) =>
                        setValues((current) => ({ ...current, autoSubmit: next }))
                      }
                      label="Sign in automatically"
                    />
                  </label>
                </div>

                {errors.form !== undefined && (
                  <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-danger)]">
                    {errors.form}
                  </p>
                )}
              </>
            )}
          </div>

          <footer className="flex gap-2 border-t border-[var(--color-border)] px-6 py-4">
            <Button variant="secondary" size="md" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            {/* Nothing to save until a type has been chosen and the form
              exists. Offering Save on the chooser invites a click that can
              only produce a validation error. */}
            {(step === 'fields' || isEdit) && (
              <Button type="submit" variant="primary" size="md" className="flex-1" loading={saving}>
                {isEdit ? 'Save changes' : 'Save item'}
              </Button>
            )}
          </footer>
        </form>
      </aside>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--dur-150)]',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 size-5 rounded-full bg-white shadow',
          'transition-[left] duration-[var(--dur-150)] ease-[var(--ease-out-quint)]',
          checked ? 'left-[22px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  );
}
