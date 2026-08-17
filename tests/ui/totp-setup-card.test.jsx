/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/preact';

const scanActiveTabForTotp = vi.fn();
const updateEntryRemote = vi.fn();

vi.mock('../../src/ui/lib/messaging.js', () => ({
  scanActiveTabForTotp: (...args) => scanActiveTabForTotp(...args),
  updateEntryRemote: (...args) => updateEntryRemote(...args),
}));

const { TotpSetupCard } = await import('../../src/ui/vault/TotpSetupCard.jsx');

const URI = 'otpauth://totp/Demo:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Demo';

beforeEach(() => {
  scanActiveTabForTotp.mockReset();
  updateEntryRemote.mockReset().mockResolvedValue({});
});

afterEach(cleanup);

describe('TotpSetupCard', () => {
  it('offers scanning without the user opening the editor first', () => {
    // Setting up 2FA happens while looking at the site's setup page. Making
    // the user open the edit form and find a toggle first is two steps more
    // than that moment allows.
    render(<TotpSetupCard entryId="a" onAdded={vi.fn()} />);
    expect(screen.getByRole('button', { name: /scan this page/i })).toBeTruthy();
  });

  it('saves the URI it finds and tells the caller', async () => {
    scanActiveTabForTotp.mockResolvedValue({ found: true, uri: URI, source: 'text' });
    const onAdded = vi.fn();

    render(<TotpSetupCard entryId="entry-1" onAdded={onAdded} />);
    screen.getByRole('button', { name: /scan this page/i }).click();

    await waitFor(() =>
      expect(updateEntryRemote).toHaveBeenCalledWith('entry-1', { totpUri: URI }),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it('saves a bare secret when that is all the page shows', async () => {
    scanActiveTabForTotp.mockResolvedValue({
      found: true,
      secret: 'JBSWY3DPEHPK3PXP',
      source: 'secret',
    });

    render(<TotpSetupCard entryId="entry-1" onAdded={vi.fn()} />);
    screen.getByRole('button', { name: /scan this page/i }).click();

    await waitFor(() =>
      expect(updateEntryRemote).toHaveBeenCalledWith('entry-1', { totpUri: 'JBSWY3DPEHPK3PXP' }),
    );
  });

  it('shows why a scan failed instead of failing silently', async () => {
    scanActiveTabForTotp.mockResolvedValue({
      found: false,
      reason: 'No two-factor setup code found on this page.',
    });

    render(<TotpSetupCard entryId="a" onAdded={vi.fn()} />);
    screen.getByRole('button', { name: /scan this page/i }).click();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No two-factor/));
    expect(updateEntryRemote).not.toHaveBeenCalled();
  });

  it('rejects a malformed URI at entry rather than storing it', async () => {
    // A bad key stored now is invisible until the code is needed.
    render(<TotpSetupCard entryId="a" onAdded={vi.fn()} />);
    screen.getByRole('button', { name: /enter key manually/i }).click();

    const input = await screen.findByLabelText(/setup key/i);
    fireEvent.input(input, { target: { value: 'otpauth://totp/x?secret=NOT!BASE32' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(updateEntryRemote).not.toHaveBeenCalled();
  });

  it('accepts a valid key typed by hand', async () => {
    render(<TotpSetupCard entryId="entry-1" onAdded={vi.fn()} />);
    screen.getByRole('button', { name: /enter key manually/i }).click();

    const input = await screen.findByLabelText(/setup key/i);
    fireEvent.input(input, { target: { value: URI } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() =>
      expect(updateEntryRemote).toHaveBeenCalledWith('entry-1', { totpUri: URI }),
    );
  });
});
