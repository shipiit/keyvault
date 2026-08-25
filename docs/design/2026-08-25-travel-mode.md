# Travel Mode — design, before any code

**Status:** proposed, awaiting a decision on the open questions at the end.
**Author:** written after building trash, archive, and the recovery kit, which
between them establish most of the machinery this would need.

---

## What Travel Mode is for

It has one threat model, and it is narrow: **you are asked to unlock your
password manager by somebody you cannot refuse.** A border officer, a customs
inspection, a checkpoint. The request is to show what is in it.

Every other protection in KeyVault assumes the attacker does not have you.
Encryption at rest, auto-lock, the trust boundary — all of it fails the moment
you are standing there being asked to type your master password. Travel Mode is
the only feature that addresses that case, and it does so in one way: **the
items are not there to show.**

That is worth stating precisely, because it is the property being sold. Not
"hidden", not "encrypted twice", not "disguised". **Absent.** If a mode leaves
the data on the device in any recoverable form, then the person who can compel a
password can compel the second one too, and the feature has given a false sense
of safety in exactly the situation where that is most expensive.

## Why KeyVault cannot copy 1Password's design

1Password's Travel Mode removes vaults not marked _safe for travel_ from every
device. Afterwards you flip it off in the web dashboard and the vaults come
back.

**The vaults come back because 1Password's server still has them.** That is the
entire mechanism. Removal is safe because it is not destruction — it is a local
cache eviction against a copy held elsewhere.

KeyVault has no elsewhere. That is the product's central claim and it is not
negotiable here. So the same feature, built the same way, becomes:

> Delete some of your credentials from the only place they exist, and hope.

Which is not a feature. It is a data-loss bug with a switch on it.

This is the crux of the design, and everything below follows from it.

## What we can and cannot honestly offer

**Can offer:** the items are genuinely gone from the vault. Unlock it in front of
anyone and they are not in the list, not in search, not in the encrypted blob,
not recoverable by entering the master password. This defeats _inspection_ —
which is the actual scenario.

**Cannot offer, and must say so:**

1. **Restore without a backup.** There is nowhere else for the data to live. The
   backup file _is_ the restore path, and it must not travel with you, or the
   whole exercise is theatre.
2. **Forensic erasure.** `chrome.storage.local` is LevelDB. Deleting a key
   writes a tombstone; the old value stays in an `.ldb` file until compaction,
   which we do not control and cannot force. A forensic image of the disk may
   recover it. Travel Mode protects against _being asked to open the app_, not
   against a lab.
3. **Hiding that KeyVault exists.** The extension is visible at
   `chrome://extensions`. A vault with six items where somebody expected sixty
   is itself informative. We should not pretend otherwise.

Point 2 is the one most likely to be glossed over by a product, and the one
most likely to matter to somebody who actually needs this. It goes in the UI,
not just this document.

## Blockers found in the current codebase

These are specific and each needs handling. I found them by reading, not by
assuming.

**The rotating backup.** `src/background/storage.js` keeps the _previous_ vault
document under a second key and rotates it on every save:

```js
await chrome.storage.local.set({ [BACKUP_KEY]: current });
await chrome.storage.local.set({ [VAULT_KEY]: doc });
```

This exists to survive a corrupt write, and it is a good idea. It also means
that removing items and saving would leave a complete copy of everything —
including the removed items — sitting in local storage, decryptable with the
same master password. **Any Travel Mode implementation that does not explicitly
purge this is a no-op wearing a switch.**

**The session key.** The unlocked key sits in `chrome.storage.session`. That is
memory-only and cleared when the browser closes, so it is not a persistence
problem, but the mode must lock the vault as part of engaging, or the pre-travel
data may still be reachable through an already-unlocked worker.

**Exports on disk.** The recovery kit tells people to keep a backup, and the
backup is a file. If Travel Mode is engaged on a laptop whose `~/Downloads`
holds `keyvault-backup-*.json`, the items are on the machine in a file that the
master password opens. The UI has to say this; we cannot check it.

## Proposed design

### Marking

A per-item flag, `safeForTravel`, defaulting to **false**. Everything is left
behind unless deliberately chosen.

Default-false is the right way round: forgetting to mark an item means losing
access to it while travelling, which is inconvenient. Default-true would mean
forgetting to _unmark_ an item exposes it, which is the failure the feature
exists to prevent. Inconvenience over exposure, every time.

### Engaging

1. **Export first, and verify it.** Travel Mode cannot be engaged without an
   encrypted backup produced in this session. The file is then re-read and
   decrypted with the master password, and the entry count compared to the
   vault's. A backup that has not been proven to open is not a backup.
2. **Show exactly what will happen.** Name the counts: _"14 items will be
   removed from this device. 3 marked safe for travel will remain. The only copy
   of the 14 is the file you just saved."_
3. **Require typed confirmation** — the word `REMOVE`, not a checkbox. This is
   the one destructive action in the product; the recovery kit and trash both
   deliberately avoid friction, and this one deliberately adds it.
4. **Purge.** Rewrite the vault with only the travel-safe items, **and clear the
   rotating backup key**, and lock the vault.
5. Record `travelMode: { engagedAt, removedCount }` in settings.

### While engaged

A persistent banner, not a dismissible one, saying the vault is in Travel Mode
and how many items are absent. Somebody who forgets they are in this state and
concludes their vault is corrupted is a support problem we cannot answer.

### Disengaging

There is no "off" switch, because there is nothing to switch back on. Leaving
Travel Mode **is importing the backup** — the existing import path, unchanged.
Once the import restores an entry count matching `removedCount`, the flag
clears.

Calling it "restore from your backup" rather than "turn off" is not a wording
choice. It is the honest description of what happens, and it is the difference
between a user who keeps the file safe and one who assumes the app has it.

## Alternatives considered

**Seal on device instead of removing.** Encrypt the travel-unsafe items under a
key derived from a _second_ passphrase, held only in the user's head, and leave
the blob on disk.

Rejected. It fails the threat model precisely: somebody who can compel one
passphrase can compel a second, and now the data is still there to be produced.
It reads as safer than removal while being weaker.

**A decoy vault.** A second master password that opens a plausible, smaller
vault.

Rejected, more firmly. It creates a situation where the user is asked a direct
question and the app has prepared a lie for them to tell. The legal consequences
of that vary by jurisdiction and can be severe, and a password manager is not
the right place to make that decision on somebody's behalf.

**Do nothing.** Genuinely on the table. Users can already achieve most of this:
export a backup, delete the sensitive items, restore afterwards. Travel Mode
would package that safely rather than enable something new — the value is in
the verified backup, the accurate counts, and the purge of the rotating copy
that a manual attempt would miss.

## Open questions

1. **Is the backup-file restore path acceptable?** It means the only way back is
   a file you must keep somewhere other than the device you are travelling with.
   If that is not acceptable, Travel Mode should not be built at all — every
   other route is worse.
2. **Should engaging require the master password again**, even if the vault is
   unlocked? It is a destructive action; I lean yes.
3. **Cloud-hosted backup as a restore path?** This becomes tractable if the
   pending encrypted-sync design lands first: the remote copy becomes the
   restore path, and Travel Mode becomes closer to 1Password's. That may be an
   argument for doing sync first and Travel Mode after.

## Recommendation

Build it **after** encrypted sync, not before.

Sync gives Travel Mode a real restore path and turns it from a carefully
fenced-off destructive operation into an ordinary one. Built now, it is
correct but sharp-edged, and the sharpest edge — "your backup file is the only
copy" — is exactly the kind of thing somebody discovers at the wrong moment.

If it is wanted sooner, the design above is buildable as written. The mandatory
verified export and the rotating-backup purge are the two parts that must not be
softened.
