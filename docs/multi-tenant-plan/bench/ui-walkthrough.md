# Phase 4 UI walkthrough

Driven against a real server on a scratch `DATA_DIR`, in headless Chrome over
the DevTools protocol, two browser profiles at once so two accounts are signed
in at the same time. Every assertion below was made by a script reading the
live DOM or calling the API from inside the page, not by looking at a
screenshot. The screenshots are in `ui-walkthrough/` and are what the script
captured at each step.

Reproduce with the driver in the scratch directory, or by hand:

```
DATA_DIR=/tmp/p4data PORT=3399 npx tsx server.ts     # auth off
DATA_DIR=/tmp/p4data npx tsx scripts/seedMock.ts     # 30 contacts
DATA_DIR=/tmp/p4data PORT=3399 AUTH_REQUIRED=true npx tsx server.ts
```

---

## 1. A fresh install with sign-in switched off

![Settings with no account UI](ui-walkthrough/01-authoff-settings.webp)

| Checked | Result |
| ------- | ------ |
| Account group in Settings | absent |
| Identity row | absent |
| Identity avatar in the sidebar | absent (`[aria-label^="Signed in as"]` not in the DOM) |
| Administration group | **present** |

The Administration group is deliberately there. On an un-gated instance the
principal is the local owner, and the local owner is an admin because the
person at the keyboard is the operator. Backups, the AI configuration and the
audit log are theirs to manage. What hides is *account* UI: there is no
account to sign out of, so nothing offers to.

![No account needed](ui-walkthrough/02-authoff-account.webp)

The accounts table shows the one row an un-gated instance has, carrying the
**This device** badge for `isLocalOwner`.

---

## 2. Turning sign-in on

![Secure this instance](ui-walkthrough/07-secure-this-instance.webp)

The wizard reads **"Secure this instance"**, not "Set up Contrack", and names
what is already here: *"The 30 contacts already here stay with it."*

After submitting, the app opened with **30 contacts** still present and the
sidebar reading `Signed in as Ada Admin. Account menu.` The local owner was
converted rather than replaced, so nothing was claimed or moved.

![After setup](ui-walkthrough/09-after-setup.webp)
![Identity menu](ui-walkthrough/11-identity-menu.webp)

---

## 3. Inviting a member

![New invitation](ui-walkthrough/13-new-invitation.webp)
![The link, shown once](ui-walkthrough/14-invitation-link.webp)

The link came back as
`http://127.0.0.1:3399/join?token=CFTljNaDtKpWcEiIg06AoU1M7jVoWin8saCa511oOA4`
and is shown once. Opening it in the second browser:

![Join screen](ui-walkthrough/16-join-screen.webp)

| Checked | Result |
| ------- | ------ |
| Screen | "You've been invited" |
| Address bar after the screen mounts | `http://127.0.0.1:3399/` — the secret is gone |
| After accepting | signed in as Ben Member |
| `GET /api/contacts` for Ben | **0** — the account starts empty |

---

## 4. What a member cannot see, and cannot reach

![Member settings](ui-walkthrough/18-member-settings.webp)

| Checked | Result |
| ------- | ------ |
| Administration group | absent |
| "Available AI capabilities" card | **present**, read-only |
| Navigating to `/settings/admin/users` | redirected to `/settings` |
| `fetch("/api/admin/users")` from the member's page | **403** |

The redirect is `RequireAdmin` and the 403 is the server. Only the second one
is a gate; the first only avoids showing somebody a page of refusals.

---

## 5. Resetting a password

![The accounts table](ui-walkthrough/20-admin-users.webp)
![Row menu](ui-walkthrough/21-row-menu.webp)
![Temporary password](ui-walkthrough/23-temporary-password.webp)

The generated password matched `/^[A-Za-z0-9]{20}$/` and is shown in groups of
four. The member's open tab dropped to sign-in, because a reset revokes every
session.

![Forced password change](ui-walkthrough/25-forced-password-change.webp)

Signing in with the temporary password lands on **"Choose your own password"**
and nothing else is reachable.

### The defect the adversarial review found, checked in a browser

![A wrong temporary password](ui-walkthrough/26-forced-wrong-password.webp)

Typing the *wrong* current password:

| Checked | Result |
| ------- | ------ |
| Still on the forced-change form | **yes** |
| Shows the server's sentence ("not your current password") | **yes** |

Before the fix this replaced the whole screen with "Signed out — your session
expired" for a typo, and signing back in returned the person to the same form
with no idea what had happened. Their cookie was never touched.

With the right password, the member lands back in the app.

---

## 6. Disabling an account

![The tab drops out](ui-walkthrough/37-disabled-tab-dropped.webp)
![And says why on the way back in](ui-walkthrough/38-disabled-sign-in-refused.webp)

| Checked | Result |
| ------- | ------ |
| Admin's table after disabling | row carries the **Disabled** badge |
| Member's open tab, on its next request | drops to sign-in |
| The sign-in attempt that follows | "This account has been disabled. Ask an administrator to re-enable it." |

**A deviation from the acceptance line, and it is the right behaviour.** The
plan says the member's tab drops to sign-in *"with the disabled reason"*.
Disabling an account revokes its sessions, so the browser's next request is a
`401` and not a `403 ACCOUNT_DISABLED` — the credential is gone, and the
server no longer knows who was holding it. The tab therefore says "Signed
out", and the explanation arrives on the sign-in attempt, from the server's
own words. The `disabled` reason path is real and is used by a principal whose
credential survives the change, which is a personal token.

---

## 7. Exporting and deleting

![Delete, with the counts](ui-walkthrough/31-delete-counts.webp)

| Checked | Result |
| ------- | ------ |
| First click on Delete | `409 USER_HAS_DATA`, and the dialog shows its four counts |
| Confirm button before the checkbox | **disabled** |
| Confirm button after the checkbox | enabled |
| "Export their data first" | downloads the account's JSON |
| After confirming | the row is gone |

The counts come from the refusal, not from a separate read. That is also what
proves the guards passed: `409 LAST_ADMIN` and `400 CANNOT_TARGET_SELF` are
raised before the counts are computed, so a dialog that opened at all is a
deletion that can actually happen.

---

## 8. The audit log

![Audit log](ui-walkthrough/34-audit-log.webp)

Actions recorded during this walkthrough, read back from the page: *Invited,
Invitation accepted, Signed in, Password reset, Password changed, Account
disabled, Account enabled, Account deleted.* A grep of the rendered log for
every password and token used above found **nothing**.

---

## 9. Instance settings and registration

![Instance settings](ui-walkthrough/39-instance-settings.webp)

One page carries the registration switch, the session length, the AI
configuration and SearXNG. `/settings/ai-config` redirected to
`/settings/admin/instance` for an admin.

![Sign-in offers registration](ui-walkthrough/41-signin-with-register.webp)

With registration open, the sign-in screen offers "Create one", a stranger
created an account, and `GET /api/auth/me` reported **`role: "member"`**.
Turning the switch off again put `registrationOpen` back to `false`.

---

## 10. Backups

![Backups](ui-walkthrough/44-backups-taken.webp)

Empty state first ("No snapshots yet"), then **Snapshot now** produced a
`curator-*.db` row. Nothing in the app has ever shown these before.

---

## 11. Personal API tokens

![The token, once](ui-walkthrough/47-token-shown.webp)
![The list](ui-walkthrough/48-token-listed.webp)

| Checked | Result |
| ------- | ------ |
| Created token | starts `ctk_` |
| Listed afterwards | name and prefix, never the value |
| `GET /api/contacts` with the token | **200** |
| `GET /api/auth/me` with the token | **403 SESSION_REQUIRED** |
| After revoking | row reads **REVOKED**, and the same call answers **401** |

---

## 12. Two browsers, two accounts, one instance

Ada (30 seeded contacts) and Cleo (one contact and one list of her own),
signed in at the same time in two Chrome profiles:

| Read | Ada | Cleo |
| ---- | --- | ---- |
| `GET /api/contacts?view=slim` | 30 | 1 |
| First names returned | Karen White, Ryan Anderson | Cleo Only |
| `GET /api/lists` | — | Cleo's list |
| `GET /api/search?q=Cleo` contains "Cleo Only" | **no** | yes |
| `GET /api/ai/stats/summary` invocations | 0 (her own) | 0 (her own) |
| `GET /api/ai/stats/summary?scope=all` | **200** | **403** |

![AI usage, all users](ui-walkthrough/52-ai-stats-all-users.webp)

The **Mine / All users** control is present for the admin and absent for the
member (`[aria-label="Whose AI usage"]` is not in a member's DOM). Switching to
All users adds the per-account table.

---

## 13. Mobile

Emulated iPhone viewport, 390 × 844, `deviceScaleFactor: 2`.

![Settings on mobile](ui-walkthrough/54-mobile-settings.webp)
![Accounts as cards](ui-walkthrough/55-mobile-admin-users.webp)
![A modal as a bottom sheet](ui-walkthrough/56-mobile-bottom-sheet.webp)

| Checked | Result |
| ------- | ------ |
| Identity row at the top of Settings | present ("Ada Admin") |
| Sidebar | `display: none` |
| Admin rows | `display: flex`, `flex-direction: column` — cards, not a table |
| Column header strip | `display: none` |
| Per-cell labels (ROLE, CONTACTS, LAST SIGN-IN) | visible in each card |
| Horizontal page scroll | none (`scrollWidth <= innerWidth`) |
| Modal position | `bottom: 0`, `left: 0`, full width — a bottom sheet |
| Modal close control | 44 × 44 |
| Controls under 44 px on `/settings/account` | **none** |

The last row found one before it was fixed: the Settings back button was
36 × 36, on the one control every page in this area shares.

---

## 14. Contrast audit

`npm run audit:contrast -- --url http://127.0.0.1:3400`, against an auth-off
instance so the administration routes render rather than the sign-in screen.

```
settings         0 failing text elements
account          0 failing text elements
admin-users      0 failing text elements
admin-invites    0 failing text elements
admin-instance   0 failing text elements
admin-backups    0 failing text elements
admin-audit      0 failing text elements

TOTAL failing text elements: 1 (1 on disabled controls)
```

The one remaining failure is a disabled stepper glyph on the map view, which
WCAG exempts and which predates this phase. The script itself needed three
fixes to be a real gate: the five administration routes were not in its route
list, its default port was one nothing listens on, and it cannot carry a
session — so it has to run against an instance with sign-in off, or it
measures the sign-in screen twelve times and reports a cheerful zero.

One genuine failure it found is fixed: the AI usage empty state was
`text-on-surface-variant/30`, which measures 1.57:1.

---

## 15. Build

```
dist/assets/BackupsView-6JeBK6D7.js       2.50 kB │ gzip: 1.17 kB
dist/assets/AuditView-KAGgnlc6.js         4.87 kB │ gzip: 1.84 kB
dist/assets/InvitationsView-DGZzoOeH.js   6.37 kB │ gzip: 2.43 kB
dist/assets/UsersView-Le4qlMun.js        14.48 kB │ gzip: 4.39 kB
dist/assets/InstanceView-CKCpEQFJ.js     25.69 kB │ gzip: 7.05 kB
dist/assets/SettingsView-C_mhkKkh.js    105.90 kB │ gzip: 25.88 kB
```

Five chunks of their own, and the settings chunk fell from 119.23 kB to
105.90 kB. Checked by string rather than by filename: "Delete account and
data", "Anyone can create an account" and "Send this link" each appear in one
administration chunk and in no other, so a member never downloads them.
