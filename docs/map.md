# Map

The **Map** shows your contacts where they live and work. Use it to filter people by place, to select people by area, and to fix a pin that is in the wrong place.

![The map with contact pins, number clusters and the Map insights panel open on the right](images/map.png)

Open **Map** in the sidebar, or press `Cmd+Shift+M` (`Ctrl+Alt+M` on Windows
and Linux).

## Who is on the map

A contact is on the map when it has a pin. Contrack places the pin from the contact's location or first address, or you place the pin by hand.

- Archived contacts, contacts in the trash and ghosts are not on the map.
- A contact with an address but no pin shows "Not on the map yet" on its page. See [Move a pin by hand](#move-a-pin-by-hand).
- A new pin can take a little while to appear, because Contrack looks up addresses in the background (see [How Contrack places pins](#how-contrack-places-pins)).

## Pins, clusters and stacks

- **A pin** is the contact's picture. Select it to open the contact over the right side of the map. Select the map, or press `Esc`, to close the contact.
- **A cluster** is a circle with a number. It holds contacts that are too close to tell apart at this zoom. Point at it to see up to five of its people, the ones with the most logged interactions first. Select it to zoom in until it splits.
- **A stack** is a cluster that never splits, because its people share one place, such as a city. Select it to see a list of the people, up to 50, under a line such as "12 people here". Select a name to open the contact. The list marks the open contact and stays open, so you can go through the people. `Esc` closes the list.

When the map opens a contact, it moves the pin to the middle of the part of the map that you can still see.

## The hover card

Point at a pin to see its card after a moment. The next pin's card opens at once, so you can move from pin to pin. The card shows:

- the name, the role and company, and the score when you track the contact, for example "Score 72"
- the location and the local time there
- the most urgent fact: a follow-up that is overdue or due this week, else the last contact, for example "Last contact 3 weeks ago"
- up to three tags and the first list, and how many more there are

Move the pointer into the card to use its buttons: **Open contact**, **Log interaction**, **Add follow-up**, **Add to list** and **Adjust pin**. A button closes the card. The card closes a moment after the pointer leaves it.

The card stays inside the part of the map that you can see. It opens away from the toolbar, the bottom line, the open contact and **Map insights**, and it changes side when the map moves.

With the keyboard, move to a pin with `Tab` to see its card, and press `Space` to move into its buttons. `Esc` closes the card and puts the focus back on the pin. A second `Esc` closes the open contact.

On a phone, the first tap on a pin shows its card at the bottom of the map, with the same buttons. Tap the pin again, or tap **Open**, to open the contact. Tap the map to close the card.

## Filter the map

Type in **Filter contacts** at the top left, or press `/` to go there. Words match the name, company, role, location, industry and tags. A facet becomes a pill when a space follows it, or when you pick it from the list under the box. The page address keeps your filter, so you can share the link, and it keeps it while a contact is open.

The filter reads every [facet](search.md#facets): `role:`, `company:`, `location:`, `industry:`, `tag:`, `list:`, `score:`, `updated:`, `contacted:`, `tracked:`, `missing:` and `near:`. A value with a space goes in double quotes, for example `industry:"Venture Capital"`.

To find the people around a place:

1. Type `near:` and a place, for example `near:Paris` or `near:London/50km`. With no distance, the distance is 25 km.
2. Type a space, or press `Enter`. The pill says "(resolving…)" while Contrack looks up the place. The pill turns red when Contrack finds no such place, and `Enter` tries again.

When nobody matches, the toolbar says, for example, "0 of 240 match" and offers **Clear filters**, which clears the whole filter. The **X** in the box clears the filter text and all its pills.

### Go to a place

1. Select **Go to**. The box becomes a place search.
2. Type a place, for example "Lisbon", and press `Enter`.
3. The map flies to the place. "Nothing found for that place" means the lookup found no match.

Select **Filter**, or press `Esc`, to go back to the filter.

### Fit all

**Fit all** (`F`) fits the map to every contact that the filter keeps. When your network is wider than the map can show, it shows the part with the most people.

## The bottom line

The line in the bottom left corner says who is in view:

- "30 in view", or "12 of 30 in view" when some of the people who match are off the screen, or "No one in view".
- **4 overdue** counts the people in view whose follow-up day has passed. Select it to show only them, and select it again to show everyone. **Clear filters** turns it off too.
- **Fit all** shows when no one is in view.
- With the **Heat** layer on, the line shows the heat's legend, from **Fewer** to **More**. When you zoom in past the heat, it offers **Zoom out for heat**.

## Layers

The **Pins** and **Heat** switch sets what the map draws.

- **Pins** draws the pins, the clusters and the stacks.
- **Heat** shows where your network gathers, as a field of colour. Every person counts, and a person with many logged interactions counts up to twice as much. The colours scale to your busiest place, so a small network and a large one both use the whole range. The heat sits under the place names.

As you zoom in towards one city, the heat fades and the pins come back. Contrack saves your layer to your account.

## Saved views

A saved view keeps the map's position, zoom, filter and layer under a name.

1. Set up the map as you want it.
2. Open **Views** and choose **Save current view…**.
3. Type a **View name**, up to 60 characters, and select **Save view**.

To go back to a view, open **Views** and choose it. While a view is active, the menu shows its name. Each view in the menu has a rename button and a delete button. You can keep up to 100 views.

A view has its own link, so you can bookmark it. When you change the filter or the layer, the map leaves the view. A link to a view that was deleted opens the map without it, and says so.

## Map insights

**Map insights** sums up the people in view. On a wide screen, select the **Map insights** button in the top right corner, or press `I`. On a phone, select **Insights**.

- **Summary** shows the **Top industries**, **Top companies** and **Top tags** of the people in view, five of each, as bars. Select a bar to add it to the filter, for example `industry:"Venture Capital"`. **Time zones** lists the time zones that the people in view are in.
- **People** lists everyone in view, with the picture, the score ring, the name and the company. Select a person to fly the map to their pin.

With no one in view, the panel says "No one in view". Contrack remembers whether you left the panel open.

## Select contacts on the map

Select people by area, then act on all of them at once.

![The map with a box selection, the selection bar and the bulk bar at the bottom](images/map-selection.png)

- **Box**: hold `Shift` and drag across the map. **Select** → **Box select** tells you how.
- **Lasso**: press `L`, or choose **Select** → **Lasso select**. Then drag a shape around the people. The lasso ends when you let go. `Esc` cancels it.
- **All in view**: choose **Select** → **All in view**. On a phone, open **Filters** and select **Select all in view**.

Each selection adds to the people you already selected. It picks only people who match the filter. Box and lasso need a mouse or a trackpad. On a touch screen, use **Select all in view**.

A selection stays when you change the filter. The bar then says how many are hidden, for example "12 selected (3 hidden by filter)". A cluster shows how many of its people you selected, for example "3 of 12 selected".

### The selection bars

Two bars open at the bottom of the map:

- The first bar shows the count, **Add follow-up**, **Zoom to selection** and a button that clears the selection. `Esc` clears the selection too.
- The second bar is the bulk bar of the Network list: **Track** (or **Untrack**), **Archive**, **List**, **Field**, **Color**, **CSV** and **Delete**. See [The Network list](contacts.md#the-network-list).

### Add a follow-up to many people

1. Select the people.
2. Select **Add follow-up**.
3. Type a **Task title**, for example "Catch up over coffee".
4. Choose a due date: **Tomorrow**, **3 days**, **Next week** or **Pick date**.
5. Select the add button, for example **Add to 12 contacts**.

Each contact gets its own follow-up, which shows in **Up next** on Pulse (see [The Pulse page](pulse.md#the-pulse-page)). One follow-up goes to 100 contacts at most.

## The map on a contact page

A contact's **Details** card shows where the person is, under their addresses.

| The contact has       | The card shows                                  |
| --------------------- | ----------------------------------------------- |
| A pin                 | A small map, **Open in map** and **Adjust pin** |
| An address but no pin | "Not on the map yet" and **Set location**       |
| Neither               | Nothing                                         |

- When the contact has a pin, the menu of every address row has **Show on map**.
- The first address places the pin, and its row says **Map pin**. Move another address to the top to move the pin there.
- A pin that you placed yourself shows **Placed by hand**.
- When the contact is open over the Map page, the small map is hidden, and **Adjust pin** stays.

## Move a pin by hand

The geocoder can put a pin in the wrong place, for example in another town with the same name. You can move the pin yourself.

1. Open the contact.
2. Under the small map, select **Adjust pin**. For a contact with no pin, select **Set location**.
3. Move the pin in one of three ways:
   - Drag it.
   - Tap or click the map where the pin belongs.
   - Move to the pin with `Tab` and press the arrow keys. `Shift` with an arrow key moves it five times as far.
4. Check the coordinates under the map.
5. Select **Save**. The button works only after the pin has moved.

![The Adjust pin dialog with the pin on a small map and its coordinates under it](images/adjust-pin.png)

**Cancel** closes the dialog and keeps the pin in its old place.

After you save, the contact shows **Placed by hand**. The geocoder does not move a pin that you placed. It reads the address again only when you change the address, or when you choose **Use address again**.

**Use address again**, in the same dialog, gives the pin back to the geocoder. The contact shows "Not on the map yet" until the geocoder places the pin again.

## Basemaps

- The map follows the app's theme: a light basemap with the light theme, and a dark basemap with the dark theme.
- The default basemap comes from OpenFreeMap. It needs no key and no account. Your browser loads the map tiles from it.
- The credit for the basemap is behind the "i" button in the bottom right corner.
- When the basemap does not load, the map says "The basemap did not load. Pins still work".
- An operator can serve the basemap from the instance itself, also for offline use. See [Map in the configuration reference](configuration.md#map).

## The map remembers where you left it

The map opens where you left it in this browser, also after a reload. This position stays in the browser, so it does not follow you to other devices. A link to a saved view opens that view instead.

## Keyboard

| Key     | What it does                  |
| ------- | ----------------------------- |
| `/`     | Focus search                  |
| `F`     | Fit all in view               |
| `I`     | Toggle insights pane          |
| `L`     | Lasso select                  |
| `Esc`   | Clear selection or close card |
| `Enter` | Open contact                  |
| `Space` | Card actions                  |

`Tab` moves to the pins. When the map has focus, the arrow keys pan it. `/`, `F`, `I` and `L` are single-key shortcuts, so the **Single-key shortcuts** switch in **Settings → Keyboard** turns them off. See [Keyboard shortcuts](keyboard-shortcuts.md).

## On a phone

- The toolbar becomes three buttons: **Filters**, **Fit all** and **Insights**. **Filters** opens a sheet with the filter, **Go to**, the **Map layer** switch, **Saved views** and **Select all in view**.
- A tap on a pin shows its card at the bottom. A second tap opens the contact over the whole map. When you close the contact, its pin is in the middle of the map.
- Pinch to zoom. The map does not rotate.
- Box and lasso selection do not work with a finger. Use **Select all in view**.

## How Contrack places pins

Contrack finds the place for an address with Nominatim, the OpenStreetMap geocoder. Nominatim needs no key, and Contrack sends it only the address text. The lookups run in the background, about one address a second. Contrack keeps every answer, and it does not try an address that found nothing again for seven days. When the server starts, it queues every contact that has a location and no pin.

## Automate it

`GET /api/contacts/map` lists the contacts on the map. `PATCH /api/contacts/:id/location` moves a pin, or gives the pin back to the geocoder. See [Contacts in the REST API reference](api-reference.md#contacts).

## Related

- [Search and Ask Contrack](search.md#facets)
- [Pulse and tracking](pulse.md#track-a-contact)
- [Contacts](contacts.md#the-contact-page)
- [Configuration reference](configuration.md#map)
