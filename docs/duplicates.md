# Duplicates

Contrack finds contacts that are the same person and helps you merge them.
This page covers what counts as a duplicate, the checks that run by
themselves, scans, review, merges, and how to undo a merge.

![Settings, Duplicates: the three scans, Scan now, and the Automatic merging settings](images/duplicates.png)

## What counts as a duplicate

Contrack compares the contacts in your own account. Contacts in other accounts
on the same instance never take part.

These matches are exact. Each one gives the pair a confidence:

| Match                             | Example                                  | Confidence |
| --------------------------------- | ---------------------------------------- | ---------- |
| Same email address                | `ada@example.com` on both                | 98%        |
| Same phone number                 | one number, written two ways             | 95%        |
| Same name at the same company     | two "Ada Park" at Northwind              | 95%        |
| Same name from two import sources | "Ada Park" from Google and from LinkedIn | 92%        |
| Same name and nothing else        | two "Ada Park"                           | 90%        |
| Nickname                          | "Bob Hale" and "Robert Hale"             | 88%        |
| Middle name added                 | "Anton Kovacs" and "Anton Peter Kovacs"  | 88%        |

A pair that is close but not exact gets a score from several signals:

- The same profile link, such as one LinkedIn URL on both. This alone gives
  93%.
- Names that are spelled nearly the same, or that sound the same, such as
  "Smith" and "Smyth".
- The same company, or a very similar company name.
- The same city.
- Two different import sources.
- Embeddings: how alike the two contacts read as a whole. By default Contrack
  makes embeddings on your machine with its built-in model. An admin can
  choose a provider model instead, see
  [Models for each task](ai.md#models-for-each-task).

When an AI provider is connected, a Smart or Full scan asks it about the pairs
that stay unclear. Without a provider, the scan keeps the strongest of those
pairs as suggestions, at a lower confidence, so they always wait for you.

A note can also add a pair. With AI on, Contrack finds the people a note
names. When a name is close to one of your contacts, but not a sure match, the
pair gets the badge **Mentioned in a note**.

## When Contrack checks

- **A new contact.** A few seconds after you add one. The switch is **Check
  new contacts automatically**, on by default.
- **An import.** When each import finishes. The switch is **Check imports
  automatically**, on by default. The check compares the new contacts with
  your other contacts and with each other.
- **A scan.** Only when you start one.

The two automatic checks do not ask an AI provider. A pair at or above your
auto-merge sensitivity merges by itself. Every other pair waits in **Possible
duplicates**.

## Scan for duplicates

1. Open **Settings → Duplicates**.
2. Choose a scan:

   | Scan           | What it finds                                                                                          |
   | -------------- | ------------------------------------------------------------------------------------------------------ |
   | **Quick scan** | The exact matches in the table above. It is the fastest.                                               |
   | **Smart scan** | The exact matches, then close pairs, with AI for the unclear ones. It is selected when the page opens. |
   | **Full scan**  | Like Smart scan, after it makes a new embedding for every contact. It takes the longest.               |

3. Select **Scan now**.

A card shows each step: **Exact matches**, **AI analysis** in a Smart or Full
scan, and **Cluster grouping**. You can leave the page, and the scan goes on.
Only one scan runs at a time on an instance. If another account is scanning,
yours waits and starts by itself.

A scan reads your active contacts. It skips ghosts, archived contacts, and
contacts in the Trash. When it finishes, its results replace the list in
**Possible duplicates**.

In a scan, a pair of two contacts at or above your auto-merge sensitivity
merges by itself. A group of three or more contacts always waits for you.

> **Note:** A Smart scan and a Full scan need AI to be on. When **Use AI for
> this account** is off in **Settings → Privacy and AI**, or an admin turned AI
> off for the instance, the page offers only **Quick scan**. A Quick scan asks
> no AI provider, so it runs with AI off. The automatic checks also still run.

### Work through the results

The results open in **Swipe** view, one group at a time. **List** shows every
group at once. **New scan** starts again.

Each group shows:

- A summary and the number of contacts.
- **Weak link**, when at least one link in the group is below 60%.
- **Select primary contact**. The primary is the contact that stays. Contrack
  suggests the most complete one.
- The primary as **Primary (keeper)**, and each other contact as **Merges in**.
- **Show evidence**, which lists each link and its match.
- A warning when both contacts hold different values in one field. The
  primary's value is kept.

Select **Merge**, or swipe right, to merge the group. Select **Keep
separate**, or swipe left, to move past it. In **List** view, each row has
**Skip** and **Merge**. Tick several groups, or use **Select all**, to merge
them at once.

A group with more than 5 contacts shows a warning. A group with more than 10
contacts merges only after you tick its confirmation box.

> **Note:** In the scan results, **Keep separate** and **Skip** only move past
> the group. The pair stays in **Possible duplicates**. To tell Contrack that
> two contacts are different people, use **Keep separate** there.

Keys in the Swipe view:

| Keys                                    | What they do           |
| --------------------------------------- | ---------------------- |
| `→` or `L`                              | Merge into the primary |
| `←` or `H`                              | Keep separate          |
| `↓` or `J`                              | Next group             |
| `↑` or `K`                              | Previous group         |
| `Cmd+Z` (`Ctrl+Z` on Windows and Linux) | Undo the last skip     |

The letter keys are single-key shortcuts. They stop when you turn off
**Single-key shortcuts** in **Settings → Keyboard**. The arrows always work.

## Review possible duplicates

**Possible duplicates** is the list of pairs that wait for your decision. It
opens from:

- **Settings → Duplicates**: select **Review them**. It shows while pairs wait.
- Pulse: the **Inbox** card has a line with the count, such as "Review 4
  possible duplicates".
- The sidebar: the number on the Pulse icon.
- The command palette: when it opens empty, it can show a line such as "3
  potential duplicates detected".
- The end of an import: the button with the count, such as **Review 3
  suggestions**.

![Possible duplicates with a group of three contacts, the primary chosen, and the Merge button](images/duplicates-review.png)

A pair shows both contacts, a badge with the match and its confidence, and two
buttons. **Merge** merges the pair. The **×** button means **Not the same
person**. Select the row to see the reason, the two contacts side by side, and
**Swap primary / duplicate**.

A group of three or more contacts shows **Select primary contact**, **Show
evidence**, **Keep separate**, and **Merge** with the number of contacts. A
group of more than 5 contacts also shows a warning.

To act on many at once, tick their boxes. Then select **Merge all** or **Keep
separate**. The box at the top selects every pair.

The badge names the match:

| Badge                   | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| **Email match**         | The same email address                               |
| **Phone match**         | The same phone number                                |
| **AI match**            | Your AI provider judged the pair to be one person    |
| **Middle name added**   | One name is the other with a middle name             |
| **Mentioned in a note** | A note named someone close to this contact           |
| **Match**               | Any other match, such as the same name or a nickname |

**Keep separate** and **Not the same person** mark the two contacts as
different people. The pair does not come back to **Possible duplicates**.

When a pair waits for a contact, its page shows a banner, such as "We found
another contact that looks like Ada Park". **Review match** opens the two
contacts side by side, with **Keep separate** and **Merge contacts**. **Not
the same** closes the banner and marks the pair as different people.

Keys on **Possible duplicates**:

| Keys       | What they do       |
| ---------- | ------------------ |
| `↓` or `J` | Next pair          |
| `↑` or `K` | Previous pair      |
| `→` or `L` | Merge the pair     |
| `←` or `H` | Keep them separate |
| `Space`    | Select the pair    |

## Merge contacts by hand

1. Open **Settings → Duplicates** and select **Manual merge**.
2. Search for the contacts and choose 2 to 5 of them. Select **Compare**. The
   button shows how many contacts you chose.
3. Choose the primary, the contact that stays. Select **Preview merge
   result**.
4. Check the merged contact. Select **Confirm merge**.

The list shows your active contacts. Ghosts and archived contacts are not in
it.

## What a merge keeps

- The primary keeps its own name, company, role, and other fields. A field
  that is empty on the primary takes the other contact's value.
- Email addresses and phone numbers are combined. A value that both contacts
  hold appears once.
- Addresses, profile links, tags, interests, work history, education, and
  custom fields move to the primary. A custom field that the primary already
  has keeps the primary's value.
- Every note and interaction on the timeline moves to the primary, and so do
  mentions in notes.
- Every follow-up moves, the done ones too.
- The primary joins every list the other contact was on.
- The earlier of the two "added" dates is kept.
- Tracking stays as the primary had it. If only the other contact was
  tracked, track the merged contact again.

The other contact is hidden, not deleted, so you can undo the merge. One merge
joins at most 11 contacts: the primary and 10 more.

## Undo a merge

1. Open **Settings → Duplicates**.
2. Select **Merge activity**, the history button in the page header.
3. Find the merge and select **Undo**.

**Merge activity** lists your latest 50 merges under **Today**,
**Yesterday**, **This week**, and **Older**. Each entry says **Merged** or
**Auto-merged**, the two names, when it happened, the confidence, and the
reason. Every merge can be undone, the automatic ones too. A group merge adds
one entry for each contact that merged in, so you undo it one contact at a
time.

**Undo** brings back the other contact with its own records. If you changed a
moved record after the merge, your change stays on the primary, and the
restored contact gets the record as it was. The message after the undo says
how many records this happened to. An undone entry shows **Restored**.

## Automatic merging

The **Automatic merging** section on **Settings → Duplicates** holds three
settings. They apply to scans, imports, and new contacts.

**Auto-merge sensitivity** is the confidence a pair needs to merge with no one
asked:

| Setting                | A pair merges by itself at |
| ---------------------- | -------------------------- |
| **Cautious**           | 97% or more                |
| **Balanced** (default) | 93% or more                |
| **Eager**              | 88% or more                |

**Check new contacts automatically** and **Check imports automatically** turn
the two automatic checks on or off. While a setting differs from its default,
**Reset to defaults** appears at the end of the page.

## What weakens a match

- **A value that many contacts hold.** A phone number on three contacts is
  often one household. Each contact beyond the pair takes 3 points off the
  match. A number on three contacts drops from 95% to 92%, so under
  **Balanced** it waits for you. An email address on three contacts drops
  from 98% to 95% and still merges. No match drops below 60%.
- **Names that disagree.** "Ada Twin" and "Ben Twin" with one phone number are
  two people. So are "Robert Hale Sr." and "Robert Hale Jr.". A pair like this
  stops at 85%, below every setting, and waits for you with the reason on it.
  A nickname, an initial, a short form such as "Sue" for "Susanna", a near
  spelling, or the same sound is not a disagreement. Last names are not
  compared, so a married name changes nothing.
- **A shared mailbox.** An address such as `team@`, `info@`, `sales@`, or a
  household address such as `park.family@` is not proof of one person. It
  counts like a shared company.
- **A known pair.** Once you mark two contacts as different people, the pair
  does not come back to **Possible duplicates**. The automatic checks also
  leave alone two people mentioned in the same note.

Scripts can start a scan and merge contacts too. See the
[REST API reference](api-reference.md).

## Related

- [Contacts](contacts.md)
- [Ghosts](contacts.md#ghosts)
- [Import a file](import-and-sync.md#import-a-file)
- [Models for each task](ai.md#models-for-each-task)
- [Keyboard shortcuts](keyboard-shortcuts.md)
