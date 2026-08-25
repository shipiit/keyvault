# Encrypted sync — design, before any code

**Status:** proposed, awaiting decisions on the open questions.
**Companion:** `2026-08-25-travel-mode.md`, which depends on this landing first.

---

## What sync must not break

One machine, one vault, and an exported file as the only backup is the largest
remaining gap in this product. It is also the feature most likely to lose data,
because it is the first one where two copies of the truth exist at once.

Three properties are not up for negotiation:

1. **Zero-knowledge.** Whatever holds the remote copy sees ciphertext and
   nothing else — no metadata, no titles, no counts.
2. **No KeyVault server.** There is no service to sign up to. If sync needs one,
   it is the wrong design for this product.
3. **No silent loss.** A merge that quietly drops an edit is worse than no sync
   at all, because it gives the user a reason to stop keeping backups.

## Two problems, and only one of them is hard

**Transport** — getting an encrypted blob somewhere both machines can read.
Several workable answers.

**Merge** — deciding what the vault contains when both machines changed it.
This is the part that eats password managers, and where the design effort
belongs.

## Transport

I probed what an extension page can actually do rather than assuming:

```
showSaveFilePicker    function      showDirectoryPicker   function
FileSystemFileHandle  function      isSecureContext       true
chrome.identity       undefined     launchWebAuthFlow     undefined
```

`chrome.identity` is absent because the manifest never requested it. That is
less an obstacle than a signal: every OAuth option begins by adding a permission
this extension has so far not needed.

### Option A — a file in a folder the user already syncs (recommended)

The user picks a file with `showSaveFilePicker`, inside a directory their
operating system already synchronises: iCloud Drive, Dropbox, OneDrive, Google
Drive for desktop, Syncthing, a network share. KeyVault writes the encrypted
document there and reads it back. The handle is kept in IndexedDB so the same
file is reused without asking again.

What it costs: **nothing**. No OAuth, no tokens, no new manifest permission, no
provider relationship, and — for a product whose front page enumerates its
network requests — **no new network request at all**. The syncing is done by
software the user already trusts with their files, and KeyVault never learns
which provider it is.

What it cannot do: reach a phone with no filesystem, or help a user with no such
folder. It is also only as reliable as the provider's own conflict handling,
which is why the merge below must not assume the file arrived intact or in
order.

A limitation that belongs in the UI: permission for a stored handle may need
re-granting with a click after a browser restart. Sync cannot be entirely
silent on every launch.

### Option B — OAuth to a named provider

Google Drive's `appDataFolder`, or Dropbox. Requires the `identity` permission,
an OAuth client, token storage and refresh, and a request to a provider. Works
without a desktop sync client, which is its real advantage.

The cost is that it makes KeyVault a client of somebody's API, and the README
currently lists two network requests and explains both.

### Option C — WebDAV or a plain HTTPS endpoint

Nextcloud and similar. Needs host permissions for an arbitrary URL and storage
of the user's server credentials. Good for self-hosters, a poor default.

### Recommendation

**Option A**, keeping B as a possible second provider later. It is the only one
that adds no permission, no network request and no third party — which happens
to be the entire argument for this product.

## Merge — the actual design

### What already helps

The data model is closer to sync-ready than it looks:

- every entry has a stable `id` and an `updatedAt`
- deletions are **soft** (`deletedAt`), and archiving is soft too
  (`archivedAt`) — so both are already tombstones rather than absences

That last point matters more than anything else here. A hard delete is
unmergeable: the absence of an entry is indistinguishable from it never having
arrived. Soft deletion means the trash built for undo turns out to be the thing
that makes sync correct.

### What is missing

- **A sync watermark.** Each device must remember the state it last agreed
  with, or it cannot tell "changed since we synced" from "changed ever".
- **A device identity.** A random id per installation, so a conflict can say
  where it came from.
- **A revision counter per entry**, incremented on every write. Wall-clock
  `updatedAt` cannot be trusted for ordering across machines: clocks drift, and
  a laptop with a wrong clock would silently win every conflict forever.
  `updatedAt` stays for display; ordering uses the counter, with `updatedAt`
  only as a tiebreak.

### The algorithm

A three-way merge, per entry, between **local**, **remote**, and **base** — the
last state this device agreed with.

| local vs base | remote vs base | result       |
| ------------- | -------------- | ------------ |
| unchanged     | unchanged      | keep as is   |
| changed       | unchanged      | keep local   |
| unchanged     | changed        | take remote  |
| changed       | same change    | keep either  |
| changed       | changed apart  | **conflict** |

Deletion is just another change, with one deliberate exception: **an edit beats
a delete.** If one machine deleted an entry and another edited it, the entry
comes back with a note saying so. A lost edit is invisible; a resurrected item
is obvious and takes two clicks to delete again.

### Conflicts are copies, never overwrites

A genuine conflict produces **both** versions. The remote one is kept as a new
entry titled `Bank (conflict from MacBook, 25 Aug)`, tagged `conflict`.

This is the whole safety argument. Any rule that picks a winner — newest wins,
longest wins, local wins — silently deletes somebody's password some of the
time. A duplicate is a small annoyance the user can see and resolve. A lost
password is a support request that cannot be answered, because the data is gone.

### Settings and folders

Last-writer-wins, no conflict copies. They are preferences, not data, and a
conflict copy of a setting is nonsense.

## Encryption and keys

The remote document is the **same sealed format as an exported backup** —
already implemented, already tested, already understood by import. Sync becomes
"write the backup automatically, and read it back intelligently", which keeps
one format instead of inventing a second.

Both devices derive the same key from the same master password, so the remote
copy is opaque to whatever holds it.

**Changing the master password re-keys everything.** The remote copy becomes
undecryptable by other devices, which must report exactly that rather than
failing mysteriously. The device that changed it uploads immediately; the others
prompt for the new password.

## Failure modes to design for, not discover

- **Two devices writing at once.** The provider may produce its own conflict
  file (`vault (conflicted copy).kvault`). Detect and merge those rather than
  ignoring them.
- **A partial or truncated file.** The sealed format authenticates, so a bad
  read fails closed. Never overwrite a good local vault with a document that did
  not decrypt.
- **Clock skew.** Handled by the revision counter above.
- **A remote belonging to a different vault.** Compare the KDF salt fingerprint
  — the same value the recovery kit prints — and refuse to merge two unrelated
  vaults.

## Phases

**Phase 1 — manual.** A _Sync now_ button. Pick a file, write, read, merge, show
what changed. No background behaviour at all.

Worth shipping on its own: it is automated encrypted backup into a folder that
already leaves the machine, which is more than exists today.

**Phase 2 — automatic.** On unlock, on change (debounced), and on a timer. Only
after the merge has been exercised by hand.

**Phase 3 — a second provider**, if Option A proves too limiting.

## Open questions

1. **Option A or B?** A adds nothing; B works without a desktop sync client.
2. **Are conflict copies acceptable?** It means occasionally seeing
   `Bank (conflict from MacBook)` in the list. The alternative is a rule that
   sometimes deletes a password silently.
3. **Ship Phase 1 alone first?** I would: small, useful by itself, and it makes
   the merge observable before anything automatic depends on it.

## Recommendation

Option A, Phase 1, conflict copies. Then Travel Mode, which stops being sharp
once there is a remote copy to come back from.
