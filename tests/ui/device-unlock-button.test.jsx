/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';

const send = vi.fn();
const evaluatePrf = vi.fn();

vi.mock('../../src/ui/lib/messaging.js', () => ({ send: (...args) => send(...args) }));
vi.mock('../../src/ui/lib/webauthn.js', () => ({
  evaluatePrf: (...args) => evaluatePrf(...args),
  createPrfCredential: vi.fn(),
  DEFAULT_RP_DOMAIN: 'iamrraj.com',
  isWebAuthnAvailable: () => true,
}));

const { DeviceUnlockButton } = await import('../../src/ui/vault/DeviceUnlock.jsx');

const PRF = new Uint8Array(32).fill(3);

/** What `device/status` reports when Touch ID is set up. */
function enrolled() {
  send.mockImplementation(async (channel) => {
    if (channel === 'device/status') {
      return { enabled: true, credentialId: 'cred-1', rpId: 'iamrraj.com' };
    }
    return { unlocked: true };
  });
}

beforeEach(() => {
  send.mockReset();
  evaluatePrf.mockReset();
  evaluatePrf.mockResolvedValue(PRF);
});

afterEach(cleanup);

describe('DeviceUnlockButton', () => {
  it('prompts for Touch ID on its own, without waiting for a click', async () => {
    // The point of Touch ID is not having to do anything. A button you must
    // click first saves almost nothing over typing the password.
    enrolled();
    const onUnlocked = vi.fn();
    render(<DeviceUnlockButton onUnlocked={onUnlocked} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalledWith('cred-1', 'iamrraj.com'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
  });

  it('prompts once, even as state settles across several renders', async () => {
    // Re-prompting puts the user under a system dialog they just dismissed,
    // with no way to reach the password field beneath it.
    enrolled();
    render(<DeviceUnlockButton onUnlocked={vi.fn()} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(evaluatePrf).toHaveBeenCalledTimes(1);
  });

  it('uses the RP ID the credential was registered under', async () => {
    // A credential releases key material only under its own RP ID; the
    // default would silently fail for anyone who enrolled on another domain.
    send.mockImplementation(async (channel) =>
      channel === 'device/status'
        ? { enabled: true, credentialId: 'cred-2', rpId: 'example.test' }
        : { unlocked: true },
    );
    render(<DeviceUnlockButton onUnlocked={vi.fn()} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalledWith('cred-2', 'example.test'));
  });

  it('renders nothing at all when device unlock was never set up', async () => {
    send.mockResolvedValue({ enabled: false, credentialId: null, rpId: null });
    const { container } = render(<DeviceUnlockButton onUnlocked={vi.fn()} />);

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(container.textContent).toBe('');
    expect(evaluatePrf).not.toHaveBeenCalled();
  });

  it('says nothing when the prompt is declined, and leaves the button', async () => {
    // Cancelling is a choice — most likely "I'll type it instead". Reporting
    // "the operation was aborted" for that reads as a malfunction.
    enrolled();
    const declined = new Error('The operation either timed out or was not allowed.');
    declined.name = 'NotAllowedError';
    evaluatePrf.mockRejectedValue(declined);

    render(<DeviceUnlockButton onUnlocked={vi.fn()} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('does report a real failure', async () => {
    enrolled();
    evaluatePrf.mockRejectedValue(new Error('this device has no authenticator'));

    render(<DeviceUnlockButton onUnlocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no authenticator/i));
  });

  it('lets the user try again by hand after declining', async () => {
    enrolled();
    const declined = new Error('cancelled');
    declined.name = 'NotAllowedError';
    evaluatePrf.mockRejectedValueOnce(declined).mockResolvedValueOnce(PRF);

    const onUnlocked = vi.fn();
    render(<DeviceUnlockButton onUnlocked={onUnlocked} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalledTimes(1));
    screen.getByRole('button').click();

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
  });

  it('never unlocks the vault when the authenticator refuses', async () => {
    enrolled();
    evaluatePrf.mockRejectedValue(new Error('refused'));
    const onUnlocked = vi.fn();

    render(<DeviceUnlockButton onUnlocked={onUnlocked} />);

    await waitFor(() => expect(evaluatePrf).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalledWith('device/unlock', expect.anything());
    expect(onUnlocked).not.toHaveBeenCalled();
  });
});
