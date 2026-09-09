# Rollback rehearsal

Run on a copy of a real 1.5.5 database taken from this machine: 30 contacts,
111 interactions, 11 AI invocations, `user_version = 1`, no accounts. Two
avatars, one attachment, one orphan and one shared logo were added to it in
the 1.x layout first, because that database referenced no uploads and the
relocation is half of what a rollback has to undo.

Every command below was run in order. Output is verbatim.

## 1. Migrate

```console
$ DATA_DIR=/tmp/ctk-rehearsal npm start   # the boot log, trimmed to the migration
[Database] Pre-tenancy backup written to /tmp/ctk-rehearsal/backups/pre-tenancy-2026-09-09T21-04-02-232Z.db in 3ms
[Database] Added status column to users
[Database] Added credentialState column to users
[Database] Added mustChangePassword column to users
[Database] Added passwordChangedAt column to users
[Database] Added disabledAt column to users
[Database] Added createdBy column to users
[Database] Created the local owner account (45e9b989-ab8c-4172-ba02-51ecd92459d9)
[Database] Tenancy migration v0 to v1 in 7ms (columns 4 added, 1ms; trigger drops 14 dropped, 0ms; local owner 0ms; claim 30 contacts, 111 interactions, 11 ai_invocations, 0ms; child backfill 0 rows, 0ms; invariant triggers 0ms; composite indexes 0ms)
[Database] Relocated 2 avatar(s) and 1 attachment(s) under uploads/u/ in 1ms
[Database] Moved unreferenced upload orphan-real.jpg to uploads/orphaned/
[Database] 1 unreferenced upload(s) moved to uploads/orphaned/. Nothing was deleted.
[Database] contacts_fts rebuilt at v3 with ownerTok: 30 rows in 5ms
[Database] Rebuilt search_embeddings with a partition key: 0 vectors copied at 384 dim in 8ms
[Database] Rebuilt contact_embeddings with a partition key: 0 vectors copied at 384 dim in 7ms
[Database] Backfilled phoneticHash for 30 contacts
[after migration]
  user_version: 3
  tenancy: {"value":"1"}
  users: [{"username":"local","role":"admin","credentialState":"none"}]
  unowned contacts: {"n":0}
  contacts: {"n":30} interactions: {"n":111}
  avatarUrls: [{"avatarUrl":"/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/avatars/avatar-real-0.jpg"},{"avatarUrl":"/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/avatars/avatar-real-1.jpg"}]
  fileUrls: [{"fileUrl":"/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/files/file-real.pdf"}]
```

## 2. Verify

```console
$ DATA_DIR=/tmp/ctk-rehearsal npm run tenancy:verify
tenancy-verify: /tmp/ctk-rehearsal/curator.db
  pass   1  contacts has no unowned rows
  pass   1  lists has no unowned rows
  pass   1  interactions has no unowned rows
  pass   1  action_items has no unowned rows
  pass   1  dedupe_suggestions has no unowned rows
  pass   1  dedupe_exclusions has no unowned rows
  pass   1  dedupe_merge_log has no unowned rows
  pass   1  ai_invocations has no unowned rows
  pass   2  interactions owner matches its contact
  pass   2  action_items owner matches its contact
  pass   2  dedupe_suggestions owner matches its contact
  pass   2  dedupe_exclusions owner matches its contact
  pass   3  FTS row count equals active contacts
  pass   4  every FTS row has the right ownerTok
  pass   8  no FTS row has an empty ownerTok
  pass   5  search_embeddings has a PARTITION KEY
  pass   5  contact_embeddings has a PARTITION KEY
  pass   6  no flat avatar URLs
  pass   6  no flat attachment URLs
  pass   7  at most one local owner
  pass   9  search_embeddings has no NULL partitions
  pass   9  contact_embeddings has no NULL partitions
  pass  10  search_embeddings rows match their contact's owner
  pass  10  contact_embeddings rows match their contact's owner
  pass  11  all 27 required triggers exist
tenancy-verify: all 25 checks passed
```

## 3. Restore the backup

```console
$ cp backups/pre-tenancy-2026-09-09T21-04-02-232Z.db curator.db
$ rm -f curator.db-wal curator.db-shm
```

## 4. Move the uploads back

```console
$ DATA_DIR=/tmp/ctk-rehearsal node scripts/tenancy-rollback-uploads.mjs
tenancy-rollback-uploads: /tmp/ctk-rehearsal/curator.db
  2 avatar URL(s), 1 attachment URL(s) in the restored database

  moved: /tmp/ctk-rehearsal/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/avatars/avatar-real-0.jpg -> /tmp/ctk-rehearsal/uploads/avatars/avatar-real-0.jpg
  moved: /tmp/ctk-rehearsal/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/avatars/avatar-real-1.jpg -> /tmp/ctk-rehearsal/uploads/avatars/avatar-real-1.jpg
  moved: /tmp/ctk-rehearsal/uploads/u/45e9b989-ab8c-4172-ba02-51ecd92459d9/files/file-real.pdf -> /tmp/ctk-rehearsal/uploads/file-real.pdf

  avatars:     2 moved, 0 already in place, 0 missing
  attachments: 1 moved, 0 already in place, 0 missing

Uploads are back in the 1.x layout. Start the 1.x image.
```

## 5. Confirm the restored database is the shape 1.5.5 expects

```console
$ node check-old.cjs
user_version: 1 (1.5.5 FTS schema)
users columns: id, email, username, displayName, passwordHash, role, createdAt, updatedAt, lastLoginAt
app_settings has schema.tenancy: false
contacts: 30 | interactions: 111
contacts.ownerId column present: true
interactions.ownerId column present: false
contacts_fts has ownerTok: false
search_embeddings partitioned: false
owner-invariant triggers present: 0
avatarUrls: [{"avatarUrl":"/uploads/avatars/avatar-real-0.jpg"},{"avatarUrl":"/uploads/avatars/avatar-real-1.jpg"}]
fileUrls: [{"fileUrl":"/uploads/file-real.pdf"}]
```

## 6. Files on disk afterwards

```console
$ find uploads -type f | sort
uploads/avatars/avatar-real-0.jpg
uploads/avatars/avatar-real-1.jpg
uploads/file-real.pdf
uploads/logos/acme.png
uploads/orphaned/orphan-real.jpg
```

## What this shows

- The migration ran on a real 1.5.5 database in 7 ms, claimed all 152 rows for
  the local owner, rebuilt the FTS index with `ownerTok` in 5 ms, and
  repartitioned both vector tables.
- `tenancy-verify` passed all 25 checks on the migrated file.
- The backup is written **before** any schema change, so the restored file has
  the 1.5.5 `users` columns and nothing else. An earlier version of this branch
  took the copy after §2z-1, which left the six new `users` columns in the
  "pre-tenancy" backup. Harmless to 1.x, which names its columns explicitly,
  but a backup that is not the state you were in is a bad thing to hand
  somebody at the worst possible moment. Moved.
- The rollback script found all three relocated files by searching
  `uploads/u/*/` for the basenames the restored database still points at, and
  put them back. The shared logo was untouched, and the orphan stayed in
  `uploads/orphaned/` because no row references it in either direction.
- `contacts.ownerId` is present in the restored file. That is correct: 1.5.5
  already had it (§9i). What is absent is everything Phase 1 added —
  `interactions.ownerId`, `ownerTok`, the vector partition keys, the ownership
  triggers, and the `schema.tenancy` marker.

## The two things a rollback cannot undo

1. **`uploads/orphaned/`.** Files moved there are not moved back, because the
   restored database does not reference them either. They are still on disk;
   an operator who wants them back moves them by hand.
2. **Anything written after the upgrade.** The backup is a point-in-time copy.
   A contact added on 2.0 is not in it. This is why the rollback procedure
   starts with "stop the server" rather than ending with it.

## Reproducing this

```bash
cp curator.db curator.db-wal curator.db-shm /tmp/rehearsal/
DATA_DIR=/tmp/rehearsal npm start          # migrate, then stop the server
DATA_DIR=/tmp/rehearsal npm run tenancy:verify
cp /tmp/rehearsal/backups/pre-tenancy-*.db /tmp/rehearsal/curator.db
rm -f /tmp/rehearsal/curator.db-wal /tmp/rehearsal/curator.db-shm
DATA_DIR=/tmp/rehearsal node scripts/tenancy-rollback-uploads.mjs
```
