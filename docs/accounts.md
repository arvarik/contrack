# Accounts and sign-in

This page says when Contrack asks people to sign in, and how they sign in. It
also covers your own account, password resets, and what an admin manages.

![The sign-in screen: Username or email, Password, Keep me signed in on this device, Sign in, and Sign in with a passkey](images/sign-in.png)

## Sign-in is off by default

By default, Contrack asks no one to sign in. It runs as one built-in account,
**Local account**, which owns your data and is an admin. **Settings →
Account** is hidden, and a link to it opens a page that says **No account
needed**. MCP clients connect without a token.

This suits one person on one machine. A native install listens on `127.0.0.1`
only, and the Docker command in
[Self-hosting](self-hosting.md#install-with-docker) publishes the port there
too. The server log warns when Contrack listens on a network address with
sign-in off.

While sign-in is off, and until the first account exists, Contrack answers
only local names: `localhost`, an IP address, a name with no dot such as
`nas`, a name under a private suffix such as `.local` or `.lan`, and the host
of `PUBLIC_URL`. To use another name, add it to `ALLOWED_HOSTS` (see
[Environment Variables](configuration.md#environment-variables)).

## Turn on sign-in

Turn on sign-in before any other device can reach Contrack, and before you
create a second account.

1. Set `AUTH_REQUIRED=true` for the server. In Docker, add
   `-e AUTH_REQUIRED=true` to the `docker run` command, or set it in the
   `.env` file that Docker Compose reads. In a native install, add it to the
   `.env` file.
2. Restart Contrack, and open it by a local name, such as `localhost`. The
   setup screen appears.
3. Create your account, see [First setup](#first-setup).
4. Only then let other devices reach Contrack, see
   [Remote access](self-hosting.md#remote-access).

Until the first account exists, Contrack refuses every request for data. After
that, a person signs in, and a script or an MCP client uses a personal token
or OAuth (see [MCP and API tokens](mcp.md)). Without either, only the health
check, the app's own page and its sign-in steps answer.

Once an account with a password exists, sign-in stays on, even if
`AUTH_REQUIRED` is false. The server log says so at start. So an account
created while sign-in is off, by an admin or with an invitation, turns sign-in
on at the next start. Setup then never runs, and your contacts stay with
**Local account**, which nobody can sign in to.

## First setup

![The first-run setup screen with the fields for the admin account](images/setup.png)

The setup screen appears once, on the first visit after you turn on sign-in.
It says **Secure this instance**. The built-in account becomes yours, with
everything attached to it, so the contacts already there stay.

Enter **Your name** (optional), your **Email**, a **Username**, and a
**Password** of at least 8 characters. Contrack suggests the username from
your email. A username has 2 to 32 lowercase letters, numbers, dots, dashes, or
underscores, and starts and ends with a letter or a number. A photo is
optional.

Select **Secure this instance**. The first account is an admin, and it is
signed in at once. When the browser supports passkeys, Contrack then offers
one: select **Add a passkey**, or **Not now**.

## Sign in

1. Enter your **Username or email** and your **Password**.
2. Leave **Keep me signed in on this device** on, or turn it off on a shared
   computer.
3. Select **Sign in**.

With **Keep me signed in on this device** on, a sign-in lasts for the
instance's session length, 30 days by default. With it off, the sign-in ends
when you close the browser, and after one day at most.

Contrack remembers your username or email in this browser. **Not you?** clears
it. A wrong username and a wrong password get the same message. After 10 tries
in a minute from one address, Contrack asks you to wait.

The sign-in screen can also show:

- **Sign in with a passkey**, see [Passkeys](#passkeys).
- **Email me a sign-in link**, when an admin turned on **Sign in by emailed
  link** and mail can carry links, see [Outgoing mail](#outgoing-mail). The
  link works once, for 15 minutes.
- **Forgot your password?**, see [Reset a password](#reset-a-password).
- **Create one**, when an admin turned on **Anyone can create an account**.

A disabled account cannot sign in, and the screen says so. When a session
expires, the screen says **Signed out**.

## Passkeys

A passkey signs you in with Face ID, Touch ID, Windows Hello, or a security
key. Your password still works.

1. Open **Settings → Account**.
2. Under **Sign-in methods**, find **Passkeys** and select **Add a passkey**.
3. Follow your device's prompt.

To sign in with it, select **Sign in with a passkey**. The browser can also
offer the passkey when you select the **Username or email** field.

Each passkey shows **Synced** or **This device only**, when you added it, and
when you last used it. The pencil renames it. The trash can removes it, after
you confirm with **Remove passkey**.

Passkeys need HTTPS or `localhost`. They do not work on an IP address, such as
`http://192.168.1.50:3210`, and the **Passkeys** card then says why. Behind a
reverse proxy, set `PUBLIC_URL` to the address in the browser's address bar,
see [Remote access](self-hosting.md#remote-access).

## Your account

![Settings, Account: the profile, sign-in methods with passkeys, devices, and API tokens](images/account-settings.png)

**Settings → Account** holds these sections:

- **Profile.** **Photo** takes a JPEG, PNG, GIF, WebP, or AVIF image up to 10
  MB, cropped to 512 × 512 pixels. **Upload** saves it, and **Remove photo**
  goes back to your initials. **Display name**, **Username**, and **Email**
  save with **Save changes**.
- **Sign-in methods.** Your password and your **Passkeys**. **Change
  password** asks for your current password and signs out every other device.
  Your API tokens keep working.
- **Devices.** Each browser where you are signed in, how it signed in
  (**Password**, **Passkey** or **Emailed link**), and when it was last used.
  **This device** marks the one you are using. **Sign out other devices**
  ends the others.
- **API tokens.** Tokens for MCP clients and scripts, and the apps you
  approved with OAuth, see [Create a token](mcp.md#create-a-token).
- **Session length**, for an admin only. A link to the instance's setting,
  which applies to every account.
- **Session.** **Sign out** signs out this device.

## Reset a password

**Reset by email.** This works when outgoing mail is set up and `PUBLIC_URL`
is set.

1. Select **Forgot your password?** on the sign-in screen.
2. Enter your **Email address** and select **Send reset link**.
3. Open the link in the email. It works once, for one hour.
4. Choose a new password.

You are then signed in. Every other session ends, and your API tokens and MCP
apps stop working. One address can ask 3 times in 15 minutes, and one account
gets at most 3 links an hour. When mail cannot carry links, the screen says
"This Contrack cannot send email, so an admin resets it for you", and **I run
this server** shows the reset command.

**Ask an admin.** An admin can send you a reset link or give you a temporary
password, see [Accounts](#accounts).

**Run the reset command.** On the server, run one of these:

```bash
# A native install, in the Contrack folder
npm run reset-password <username-or-email>

# Docker
docker exec -it contrack node scripts/reset-password.ts <username-or-email>
```

The command prints a temporary password. It also signs the account out
everywhere, and its API tokens and MCP apps stop working. Use it when you are
the only admin and you lost your password. The built-in **Local account** has
no password to reset.

After a temporary password, the next sign-in opens **Choose your own
password**. Enter the temporary password, then the new one twice. Nothing else
works until you do.

## Roles

| Role       | What it can do                                                |
| ---------- | ------------------------------------------------------------- |
| **Member** | Its own contacts, and nothing else                            |
| **Admin**  | Also manages accounts and every page under **Administration** |

Each account, an admin's included, sees only its own contacts. An admin also
sees facts about the other accounts: the name, the role, the number of
contacts, the last sign-in, and AI usage. Two downloads give an admin other
accounts' contacts: **Export data**, for one account, and a snapshot on the
**Backups** page, which holds every account. The audit log records both.

## Administration

![Settings, Administration, Accounts: the list of accounts with roles, contact counts, and last sign-in](images/admin-accounts.png)

### Accounts

**Settings → Administration → Accounts** lists every account with its role,
its number of contacts, and its last sign-in. Badges mark **You**, **Local
account** (the built-in account), **Disabled**, and **Must reset** (a
temporary password is still in use).

To create an account, select **Create account**. Enter the **Email**, the
**Username**, and an optional **Display name**, choose the **Role**, and
select **Create account**. Contrack shows a temporary password once. Give it
to the person, who must replace it at the first sign-in. **Invite** opens
[Invitations](#invitations), which add someone without a password from you.

Each row's menu holds these actions:

- **Edit**: the display name and the role. Your own row has no role choice.
  The person changes their own email and username.
- **Reset password**: with outgoing mail set up and `PUBLIC_URL` set, choose
  **Email a reset link**, which works for 24 hours, or **Show a temporary
  password**. Otherwise Contrack shows a temporary password. A temporary
  password signs the person out everywhere at once, and their API tokens and
  MCP apps stop working. A link does the same when they set the new password.
  When the mail does not go, Contrack says why and deletes the link.
- **Export data**: downloads the account's data as one JSON file, for someone
  who leaves. The audit log records it.
- **Disable**: asks first, then signs the person out everywhere. Their API
  tokens and MCP apps stop working while the account is disabled. **Enable**
  undoes it at once, and their tokens work again. Disable an account before
  you delete it.
- **Delete**: two steps. The first shows what the account owns: contacts,
  interactions, lists, and files. **Export their data first** downloads it.
  Check **I understand this cannot be undone**, and select **Delete account
  and data**.

### Invitations

An invitation is a link that creates one account, once.

1. Open **Settings → Administration → Invitations**, and select **New
   invitation**.
2. Optionally enter an **Email**, as a reminder. The person picks their own.
   With outgoing mail set up, **Send it by email** also mails the link there.
3. Choose the **Role**, and when it **Expires**: **3 days**, **7 days** (the
   default), or **30 days**.
4. Select **Create invitation**. Copy the link, and select **I've copied
   it**.

Send the link the way you would send a password. The person who opens it sees
**You've been invited**, and chooses an email, a username and a password. The
new account starts empty. A link that was used, revoked or expired says so
before the form shows. The list shows each invitation as **Pending**,
**Accepted**, **Revoked**, or **Expired**. **Revoke** stops a pending link at
once. Deleting the admin who created a pending invitation revokes it too.

### Sign-in settings

**Settings → Administration → General** holds these sign-in settings:

- **Instance name**: up to 60 characters, shown in the browser tab, the
  account menu, and the sign-in screen.
- **Anyone can create an account**: adds **Create one** to the sign-in screen.
  A new account is a member and starts empty. On a server open to the
  internet, send invitations instead.
- **Sign in by emailed link**: lets people sign in with a link sent to their
  email. Set up outgoing mail and `PUBLIC_URL` first. Until both are set, the
  switch cannot turn on.
- **Session length**: **1 day**, **1 week**, **30 days** (the default), or **1
  year**, for every account. A change applies to new sign-ins. To end a
  session now, disable the account or reset its password.

The same page holds the Trash and backup settings, **Look up addresses for the
map** (see [Geocoding](configuration.md#geocoding)), and the Google OAuth
client (see [Google Workspace](import-and-sync.md#google-workspace)).

### Audit log

**Settings → Administration → Audit log** lists sign-ins, and changes to
accounts, tokens, apps, connectors and instance settings, newest first.
Filter it with **Everything**, **Accounts**, **Invitations**, **Sign-in**,
**Tokens**, or **Instance**. **Load more** shows older entries.

The log never holds a password, a token, or an invitation secret. A failed
sign-in records whether the name typed matched an account, and which account,
never the text typed. So a password typed into the wrong field does not reach
the log. Its row says **for an existing account** or **for a name with no
account**. A row by an account that was since deleted says **by a deleted
account**. Contrack deletes an entry after 90 days.

### What keeps an instance administrable

- While sign-in is off, the built-in **Local account** cannot be disabled or
  deleted, because it holds the data.
- The last active admin cannot be demoted, disabled, or deleted. Promote
  another account first.
- An admin cannot reset the password of, disable, or delete their own
  account. Ask another admin.
- Administration needs you signed in. An API token or an MCP client cannot
  use it, even an admin's.

## Outgoing mail

Contrack sends mail for invitations, password resets, sign-in links, and
tests. An admin sets it up once.

1. Open **Settings → Administration → Outgoing mail**.
2. Under **SMTP server**, enter the **Host**, the **Port**, the **Username**,
   the **Password**, the **From address**, and an optional **Reply-to**.
3. Turn on **Use TLS** for TLS from the start. Port 465 usually needs it, and
   port 587 usually does not.
4. Select **Save**. Then select **Send a test**, which mails your own address.

A badge shows **Set up here**, **Set by the environment**, or **Not set up**.
**Clear settings** removes what you saved. You can send 5 tests in 10 minutes.

The environment can set mail instead. `SMTP_URL` holds the server, such as
`smtp://user:password@smtp.example.com:587`. For TLS on port 465, it starts
with `smtps://`. `MAIL_FROM` and `MAIL_REPLY_TO` set the From and Reply-to
addresses. While `SMTP_URL` is set, the page is read-only.

**Links in mail need `PUBLIC_URL`.** A reset, sign-in, or invitation link goes
to someone's inbox. Contrack builds its address from `PUBLIC_URL` only, never
from the request, because a request can claim any address. Without
`PUBLIC_URL`:

- **Forgot your password?** offers no reset link, and says to ask an admin.
- The sign-in screen offers no emailed link, and **Sign in by emailed link**
  cannot turn on.
- **Reset password** in **Accounts** offers only a temporary password.
- An invitation is created, but not mailed. Copy its link and send it.

The **Outgoing mail** page shows a warning while `PUBLIC_URL` is missing, and
the server log warns at start. See
[Remote access](self-hosting.md#remote-access) and the
[Configuration reference](configuration.md#environment-variables).

## Related

- [Self-hosting](self-hosting.md)
- [MCP and API tokens](mcp.md)
- [Configuration reference](configuration.md)
- [REST API reference](api-reference.md#authentication)
