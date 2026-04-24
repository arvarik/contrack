# Custom Lists

Organize your contacts into user-defined groups with custom icons, drag-to-reorder, and bulk membership management.

## Creating Lists

Create a list from the **Settings → List Management** view or from the Command Palette action sub-menu (`L`):

1. Click **New List**
2. Enter a name (e.g., "Board Members")
3. Choose an icon (emoji or Lucide icon)
4. The list appears in the sidebar immediately

```bash
curl -X POST http://localhost:3000/api/lists \
  -H "Content-Type: application/json" \
  -d '{"name":"Board Members","icon":"👥"}'
```

---

## Managing Members

### Adding Contacts

- **From Contact Profile:** Use the "Lists" section on any contact's profile to toggle list membership
- **From Command Palette:** Press `→` → `L` on a search result to add it to a list
- **Bulk Add:** Select multiple contacts on the contact list → **Add to List** in the bulk action toolbar

```bash
# Add a single contact
curl -X POST http://localhost:3000/api/lists/list123/members \
  -H "Content-Type: application/json" \
  -d '{"contactId":"abc123"}'

# Bulk add
curl -X POST http://localhost:3000/api/lists/list123/members/bulk \
  -H "Content-Type: application/json" \
  -d '{"contactIds":["abc123","def456","ghi789"]}'
```

### Removing Contacts

Remove from the list detail panel or via API:

```bash
curl -X DELETE http://localhost:3000/api/lists/list123/members/abc123
```

---

## Reordering Lists

Drag lists in the sidebar or List Management view to reorder them. The order persists via the `sortOrder` column.

```bash
curl -X PUT http://localhost:3000/api/lists/reorder \
  -H "Content-Type: application/json" \
  -d '{"orderedIds":["list2","list1","list3"]}'
```

---

## Editing & Deleting

### Edit

Update a list's name or icon:

```bash
curl -X PATCH http://localhost:3000/api/lists/list123 \
  -H "Content-Type: application/json" \
  -d '{"name":"Advisory Board","icon":"🎯"}'
```

### Delete

Deleting a list removes the list and all membership records. The contacts themselves are **not** deleted.

```bash
curl -X DELETE http://localhost:3000/api/lists/list123
```

---

## Sidebar Integration

Lists appear in the left sidebar with:
- Custom icon
- List name
- Member count badge

Click a list in the sidebar to filter the contact list to only show members of that list.

<!-- Screenshot: list-manager.png -->

---

## Merge Behavior

When contacts are merged via the deduplication engine:
- The primary contact inherits all list memberships from the duplicate
- Duplicate membership entries are removed
- List member counts update automatically

This ensures list integrity is maintained through the deduplication process.
