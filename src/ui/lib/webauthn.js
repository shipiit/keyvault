import { PRF_SALT } from '../../core/device-key.js';
import { toBase64Url, fromBase64Url } from '../../core/encoding.js';

/**
 * Talking to the platform authenticator.
 *
 * Lives in the UI layer because WebAuthn needs a document — a service worker
 * cannot call it. The key wrapping it feeds is in `core/device-key.js`,
 * which stays pure and testable; this file is the thin, untestable-in-Node
 * edge that touches the browser API.
 *
 * Everything here degrades rather than throws where the platform simply
 * lacks the capability. A user on a machine with no Secure Enclave should
 * see "not available on this device", not a stack trace.
 */

/** Only platform authenticators: this must be the device, not a roaming key. */
const AUTHENTICATOR_SELECTION = {
  authenticatorAttachment: 'platform',
  residentKey: 'required',
  userVerification: 'required',
};

/**
 * Whether this browser and device can do PRF-backed device unlock.
 *
 * Capability is probed rather than assumed: `prf` support varies by
 * platform, browser version, and authenticator, and offering a feature that
 * silently cannot work is worse than not offering it.
 *
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function checkDeviceUnlockSupport() {
  if (typeof globalThis.PublicKeyCredential !== 'function') {
    return { available: false, reason: 'This browser does not support device authentication.' };
  }

  try {
    const hasPlatformAuthenticator =
      await globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!hasPlatformAuthenticator) {
      return {
        available: false,
        reason:
          'No device authentication is set up. Turn on Touch ID, Windows Hello, or a device ' +
          'password, then try again.',
      };
    }
  } catch {
    return { available: false, reason: 'This browser does not support device authentication.' };
  }

  return { available: true };
}

/**
 * Turn a WebAuthn failure into something a user can act on.
 *
 * The raw errors are unhelpful — `NotAllowedError` covers both "you
 * cancelled" and "this origin may not do that" — so the likely cause is
 * named alongside the original message rather than instead of it.
 *
 * @param {unknown} error
 * @returns {Error}
 */
function explain(error) {
  const name = error?.name ?? 'Error';
  const detail = error?.message ?? String(error);

  if (name === 'SecurityError') {
    return new Error(
      'Chrome will not allow device authentication from an extension page. This is a browser ' +
        `restriction, not something KeyVault can work around. (${name}: ${detail})`,
    );
  }
  if (name === 'NotAllowedError') {
    return new Error(
      'Device authentication was cancelled or refused. If you did not see a Touch ID prompt, ' +
        `Chrome may be blocking it on this page. (${name}: ${detail})`,
    );
  }
  if (name === 'NotSupportedError') {
    return new Error(
      `This device cannot derive a key from its authenticator, which KeyVault needs. (${name})`,
    );
  }
  return new Error(`${name}: ${detail}`);
}

/**
 * Register a credential and take its first PRF output.
 *
 * Runs once, when the user turns device unlock on, and only while the vault
 * is already unlocked with the master password — there is nothing to wrap
 * otherwise.
 *
 * @param {{accountName: string}} options
 * @returns {Promise<{credentialId: string, prfOutput: Uint8Array}>}
 */
export async function registerDeviceUnlock({ accountName }) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  // Not a user account in any real sense — nothing is transmitted anywhere.
  // A stable id keeps repeat registrations from piling up credentials.
  const userId = new TextEncoder().encode('keyvault-local-vault');

  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'KeyVault' },
        user: { id: userId, name: accountName, displayName: accountName },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: AUTHENTICATOR_SELECTION,
        timeout: 60000,
        extensions: { prf: {} },
      },
    });
  } catch (error) {
    throw explain(error);
  }

  if (credential === null) {
    throw new Error('device authentication was cancelled');
  }

  const results = credential.getClientExtensionResults();
  if (results.prf?.enabled !== true) {
    throw new Error(
      'This device can authenticate you but cannot derive a key, which KeyVault needs to ' +
        'unlock the vault. Keep using your master password.',
    );
  }

  // Registration reports only that PRF is available; the output itself comes
  // from an assertion, so one is made immediately.
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));
  const prfOutput = await evaluatePrf(credentialId);
  return { credentialId, prfOutput };
}

/**
 * Ask the authenticator for the PRF output, prompting the user.
 *
 * @param {string} credentialId base64url
 * @returns {Promise<Uint8Array>} 32 bytes
 */
export async function evaluatePrf(credentialId) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    });
  } catch (error) {
    throw explain(error);
  }

  if (assertion === null) {
    throw new Error('device authentication was cancelled');
  }

  const output = assertion.getClientExtensionResults().prf?.results?.first;
  if (output === undefined) {
    throw new Error('the authenticator did not return key material');
  }
  return new Uint8Array(output);
}
