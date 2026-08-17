/** Persistent keys. Namespaced so the vault cannot collide with settings. */
const VAULT_KEY = 'keyvault.vault';
const BACKUP_KEY = 'keyvault.vaultBackup';

/**
 * Persistence for the encrypted vault document.
 *
 * Uses `chrome.storage.local`, never `chrome.storage.sync`: sync has a ~100KB
 * quota and round-trips through Google's servers, both of which disqualify it
 * for a local-only, zero-knowledge design.
 *
 * Every write rotates the previous document into a backup slot first. The
 * vault is a single encrypted blob, so one damaged write would otherwise cost
 * the user every credential they have. One generation is enough to survive an
 * interrupted or corrupted write, and keeping more would double storage for
 * diminishing benefit.
 *
 * @param {object} chrome the extension API namespace
 */
export function createVaultStorage(chrome) {
  return {
    /**
     * @returns {Promise<object|null>}
     */
    async load() {
      const stored = await chrome.storage.local.get(VAULT_KEY);
      return stored[VAULT_KEY] ?? null;
    },

    /**
     * @returns {Promise<object|null>}
     */
    async loadBackup() {
      const stored = await chrome.storage.local.get(BACKUP_KEY);
      return stored[BACKUP_KEY] ?? null;
    },

    /**
     * @returns {Promise<boolean>}
     */
    async exists() {
      return (await this.load()) !== null;
    },

    /**
     * Persist a vault document, rotating the previous one into the backup.
     *
     * @param {object} doc
     */
    async save(doc) {
      if (doc === null || typeof doc !== 'object') {
        throw new TypeError('vault document must be an object');
      }
      const current = await this.load();
      if (current !== null) {
        await chrome.storage.local.set({ [BACKUP_KEY]: current });
      }
      await chrome.storage.local.set({ [VAULT_KEY]: doc });
    },

    /**
     * Promote the backup back to being the live vault.
     *
     * Called from the recovery path after `unlockVault` reports the payload is
     * corrupt despite a correct master password.
     */
    async restoreFromBackup() {
      const backup = await this.loadBackup();
      if (backup === null) {
        throw new Error('no backup vault available to restore');
      }
      await chrome.storage.local.set({ [VAULT_KEY]: backup });
    },

    /**
     * Remove the vault and its backup. Irreversible.
     */
    async destroy() {
      await chrome.storage.local.remove([VAULT_KEY, BACKUP_KEY]);
    },
  };
}
