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

/**
 * Domains that may be used as the relying-party identifier.
 *
 * Chrome will not let an extension use its own origin as an RP ID — since
 * Chrome 122 an extension may claim only a domain it holds host permissions
 * for. So device unlock needs a domain the user controls.
 *
 * Nothing is ever sent to it. The RP ID is a local label the platform
 * authenticator keys the credential to, and the credential never leaves the
 * Secure Enclave. Adding another domain means adding it to
 * `optional_host_permissions` in the manifest as well, since Chrome refuses
 * to grant a permission that was not declared.
 */
export const RP_DOMAINS = ['iamrraj.com', 'aftrdrk.dev'];
export const DEFAULT_RP_DOMAIN = RP_DOMAINS[0];

const api = globalThis.chrome ?? globalThis.browser;

/**
 * Ask for the host permission the RP ID requires.
 *
 * Requested here rather than declared up front, so a user who never turns
 * device unlock on is never asked for it at install.
 *
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
export async function requestRpPermission(domain) {
  try {
    return await api.permissions.request({ origins: [`https://${domain}/*`] });
  } catch {
    return false;
  }
}

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
export async function registerDeviceUnlock({
  accountName,
  rpId = DEFAULT_RP_DOMAIN,
  onStep = () => {},
}) {
  onStep(`Asking Chrome for permission for ${rpId}…`);
  const granted = await requestRpPermission(rpId);
  if (!granted) {
    throw new Error(
      `KeyVault needs permission for ${rpId} to register the credential. Nothing is sent to ` +
        'that domain — Chrome simply requires an extension to hold a permission for whichever ' +
        'domain it uses as an identifier.',
    );
  }

  onStep('Waiting for Touch ID…');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  // Not a user account in any real sense — nothing is transmitted anywhere.
  // A stable id keeps repeat registrations from piling up credentials.
  const userId = new TextEncoder().encode('keyvault-local-vault');

  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: rpId, name: 'KeyVault' },
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
    console.error('[keyvault] prf not enabled; extension results were', results);
    throw new Error(
      'This device can authenticate you but cannot derive a key, which KeyVault needs to ' +
        'unlock the vault. Keep using your master password.',
    );
  }

  // Registration reports only that PRF is available; the output itself comes
  // from an assertion, so one is made immediately.
  onStep('Deriving the key…');
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));
  const prfOutput = await evaluatePrf(credentialId, rpId);
  return { credentialId, prfOutput, rpId };
}

/**
 * Ask the authenticator for the PRF output, prompting the user.
 *
 * @param {string} credentialId base64url
 * @returns {Promise<Uint8Array>} 32 bytes
 */
export async function evaluatePrf(credentialId, rpId = DEFAULT_RP_DOMAIN) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        // The same RP ID the credential was registered under; the
        // authenticator will not release the PRF output otherwise.
        rpId,
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
