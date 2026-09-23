# Map View

Contrack's Map View draws your contacts on an interactive, clustered map, so you can see your network geographically.

Access via the **Map** tab in the navigation or `Cmd+Shift+M`.

<!-- Screenshot: map-view.png -->

The map is MapLibre GL JS with vector tiles. The default basemap is
[OpenFreeMap](https://openfreemap.org/). It needs no API key, no registration
and no account. It sets no request limit and allows commercial use. MapLibre
draws the attribution on the map.

## Features

### Filters and Place Search

A glass toolbar floats in the top-left corner of the map (`/` focuses the input from anywhere on the page).

#### Unified Dataset

The map and the contact list share the same TanStack Query client cache (`["contacts"]`). Filtering on the map uses the same `matchesFacet` and free-text scoring (`scoreContactMatch`) as the network list, guaranteeing that contacts on the map and in the list never disagree, and changes made in the overlay show on the map immediately.

#### Search Facets

The filter input supports full facet search with locked facet pills and autocomplete:

- `company:<name>`
- `role:<title>`
- `location:<city/country>`
- `industry:<sector>`
- `tag:<tag>` (autocompletes from slim contact tags)
- `list:<name|id>` (autocompletes from contact lists)
- `near:<place>/<km>` (default 25 km, e.g. `near:London/50km` or `near:Paris`). While resolving, the pill shows `resolving…` and matches all contacts, and pressing `Enter` resolves the place coordinates via `GET /api/geo/search` and applies client-side haversine distance filtering. A failed resolution displays the pill in error styling.
- `missing:<company|location|email|phone>`
- Free text matches across contact names, companies, roles, emails, and phone digits.

#### "Go to" Place Navigation

Clicking the **Go to** button turns the input into a place search. Typing a place name (e.g., "Paris", "Austin") and pressing `Enter` resolves the place via `GET /api/geo/search` and flies the camera to zoom level 10 (or uses `jumpTo` when reduced motion is preferred). If no result is found, an inline error ("Nothing found for that place") is displayed.

#### "Fit All"

The **Fit all** button (or keyboard shortcut `F`) fits the map's camera bounds to all placed contacts matching the current filter (or all placed contacts if no filter is active).

#### Mobile Filter Sheet

On mobile viewports below the `lg` breakpoint, the toolbar collapses to a floating "Filters" button with a badge indicating active filters. Tapping it opens a bottom sheet with the search input, facet pills, place search, and "Fit all" controls.

### Contact Pins

Each pin on the map represents one geocoded contact:

- A pin is a round avatar button named `"<name>, <company>"`
- Click a pin to open the contact's detail panel as a slide-over overlay
- The overlay supports full profile editing, timeline viewing, and interaction logging
- Press `Escape` or click the map to close it

### Cluster Markers

MapLibre groups nearby contacts into clusters. The map's GeoJSON source sets
`cluster: true`, a cluster radius of 50 pixels and a maximum cluster zoom of 14. As you zoom in:

- Large clusters break into smaller groups
- Individual pins appear at high zoom levels
- Cluster badges show the number of contacts in each group. A cluster says nothing about scores: the red At risk arc around it went with the Health layer.

A cluster is a button named `"<n> contacts, zoom in"`. A click zooms to the
level where that cluster splits.

Some clusters never split. The geocoder gives every contact in one city the
same coordinates, so their pins sit on one point at every zoom. A click on
such a cluster opens a list of the people instead, up to fifty of them, and
each name in the list is a button. Escape closes the list. A stacked pin stays
reachable this way.

### The Bottom Line

One line in the bottom-left corner says who is in view, and offers what to
do about it. It counts the people who match the filter inside the visible
bounds, 150 ms after the camera stops:

- **In view**: "30 in view", or "12 of 30 in view" when some of the people
  who match are off screen. "No one in view" when nobody is.
- **Overdue**: the people in view whose next follow-up's day is before
  today, counted by the calendar day as the contact page's banner counts
  it. It is a filter to press (`aria-pressed`): it shows only them, and a
  second press shows everyone again. No facet filters by follow-up, so it
  is not a query token, and **Clear filters** clears it with the query. It
  is hidden when nobody in view is overdue, unless it is on.
- **Fit all**: when nobody is in view, so an empty map has a way back.
- **The heat's legend**: with the Heat layer on, the ramp from "Fewer" to
  "More", as the map paints it. Zoomed in past the heat, a **Zoom out for
  heat** button stands in its place.

The line is a region named "In view", and each change is announced in a
polite live region. It keeps clear of the open insights panel, of an open
contact, and of the tab bar on a phone. On a phone MapLibre's zoom buttons
and credit sit over it, lifted by its measured height, so a line that wraps
to a second row never runs under them.

It held five chips until v2: at risk, overdue, an average score and a count
of time zones as well. At risk and the average score went with the Health
layer, and the time zones are in the insights panel, by name.

### Map Insights

From the `lg` breakpoint the insights are the page's side panel
(`SidePanel`, the same one Ask Contrack's history uses). An **Insights**
button with the insights glyph sits in the map's top-right corner, level
with the toolbar, and the map runs to the window's edge. The button opens a
320 px panel that slides in from the window's edge under it, over the map,
so opening it moves nothing on the map and the button stays where it is.
While the panel is open the button stays pressed in. The panel's heading row
holds the Summary and People switch, and under it the content takes the
panel's full width, with the scroll bar on the window's edge. The map eases
its padding on the panel's own timing and curve, so the pins and the panel
arrive together. Below `lg` the toolbar's **Insights** button opens the same
content in a bottom sheet.

- **Opening and closing**: the Insights button (a disclosure, with a tooltip
  that names the `I` key), Escape inside the panel, and `i` / `I` anywhere
  on the page. There is no second close button. Escape gives focus back to
  the button. The open state on a wide screen persists through the
  `mapPaneOpen` account preference (defaults to `true`).
- **Map insets**: the open panel carries `data-covers-map="right"`, so a
  fly-to centres its pin in the part of the map the panel leaves, and the
  zoom buttons and the credit move clear of it with its slide. A closed
  panel is `inert` and covers nothing.
- **Summary**: the top industries, companies and tags of the people in
  view, as bars. A press on a bar adds its facet to the filter. Under them,
  the time zones the people in view are in.
- **People**: a virtualised list (`@tanstack/react-virtual`) of everyone in
  view, with their avatar, score ring, name and company. A press flies the
  map to the pin.

### Selection and Bulk Actions

The map provides geographic multi-selection across placed contacts:

- **Box Selection**: Hold Shift and drag anywhere on the map to draw a selection rectangle. The SVG overlay indicates the bounding box in primary color at 15 percent fill. Pointer events are captured while drawing so the map does not pan.
- **Lasso Selection**: Press L or choose Lasso select from the Select menu to enter lasso mode. Drag a freehand polygon over any region. The camera remains fixed while drawing and ray-casting tests whether contacts sit inside the closed ring.
- **Select Menu**: The desktop toolbar includes a Select menu offering Box select (Shift+drag), Lasso select (L), and All in view.
- **Touch Devices**: Drag selection gestures are disabled on touch devices to avoid interfering with map panning and zooming. The mobile filter sheet offers a full-width Select all in view button instead.
- **Cluster Selection**: Clicking a cluster selects its member contacts through the leaves cache. Cluster badges update to show the selection ratio (for example, "3 of 12 selected").
- **Independent from Filters**: The selection set stores contact IDs directly. If a filter changes while contacts are selected, hidden contacts remain selected and the counter indicates how many are hidden by the filter.
- **Announcements**: Selection changes update an accessible live region announcing the selected count and any hidden contacts.

#### Selection Action Bars

When contacts are selected, two floating bars appear at the bottom center of the map:

1. **Secondary Map Bar**: Positioned directly above the bulk actions toolbar, displaying the selection count, a Zoom to selection button that fits the camera bounds to the selected contacts, an Add follow-up button, and a clear button. Pressing Escape clears the selection.
2. **Bulk Action Toolbar**: Reuses the network list toolbar providing soft delete with undo, archive, add to list, bulk field editing, color tagging, and CSV export.

#### Follow-up Tasks

The Add follow-up action opens a modal to create action items across selected contacts:

- Accepts a task title
- Offers quick due date presets: Tomorrow, 3 days, Next week, or a custom date picker
- Capped at 100 contacts per submission with a warning toast beyond that limit
- Invalidates the dashboard, action items, and contacts query caches on completion

### Hover Card

Pins on the map feature a responsive two-stage hover card:

- **Tooltip Mode**: Hovering a pin for 150 ms or focusing it with the keyboard opens a compact tooltip card (`role="tooltip"`). It displays the contact name, company, role, location, relationship score, last contact time, and local time. It contains no interactive buttons so hover never traps focus.
- **Pinned Dialog Mode**: Clicking a pin or pressing Space while focused pins the card into a dialog (`role="dialog"`). Focus automatically moves to its first action button.
- **Actions in Pinned Mode**: Four icon buttons enable rapid workflows directly from the map:
  1. Open contact overlay (`/map/contact/:id`)
  2. Log interaction note via Quick Interaction modal
  3. Add contact to a list
  4. Create a follow-up task
- **Details**: Features a 44 px avatar with score ring, an interactive score badge that opens the score breakdown popover, formatted local time via coordinate lookup, tags, and list memberships.
- **Keyboard and Dismissal**: Pressing Escape closes the card and returns focus directly to the pin button. Clicking the map background also closes any pinned card. On touch devices, tapping a pin opens the pinned card, and a second tap opens the full contact overlay.

### Layers and Saved Views

The map toolbar provides layer switching and a saved views dropdown for quick navigation and state sharing:

#### Map Layers

A segmented control (`aria-label="Map layer"`) switches between two layers:

- **Pins**: contact avatars and cluster markers.
- **Heat**: where the network gathers, as a MapLibre heatmap
  (`src/views/map/heat.ts`). What makes it read, from MapLibre's own
  heatmap example and the cartography on colour ramps:
  - **Density, not clusters.** The heat reads its own copy of the contacts
    with no clustering. On the pins' clustered source a cluster of twelve
    people added what one person added.
  - **Every person counts.** Each weighs 1, rising to 2 for a relationship
    with 25 or more notes. The weight was the note count alone, so a person
    with no notes added no heat.
  - **A scale from the network.** The intensity puts the densest place (the
    heaviest 1 degree cell, capped at 128 people) at full density, and each
    stop of the ramp is double the density of the one before it, from 1/128
    to all of it. Thirty people and three thousand both use the whole ramp,
    and one person still shows beside a city of fifty.
  - **A radius that grows with the zoom**, from 16 px over the world to 44 px
    at zoom 9, and an intensity that eases up with it.
  - **A ramp that turns with the basemap.** Over the light map the most is
    the darkest colour, over the dark map the brightest, so the most always
    has the most contrast with the land. Both run in OKLCH between the
    accent's deep tone and a warm yellow, and the least is transparent. The
    default accent draws CARTO's BluYl on the light map (pale yellow, green,
    teal, the accent) and a viridis-like ramp on the dark one (the accent,
    teal, green, yellow). A picked accent draws its own ramp, and the ramp
    follows the palette and the accent the way every class does.
  - **Under the labels.** The heat is drawn under the basemap's labels, so a
    city's name reads over its own heat.
  - **It gives way to the pins.** From zoom 7 the heat fades, the pins come
    back from zoom 8, and at zoom 9 the heat is gone. The geocoder gives a
    city one point, so close in the heat is one blob per city, and a pin's
    count says more.

Changing the layer updates the `?layer=` URL parameter and persists to the
user's `mapLayer` account preference.

Health was a third layer until v2: pins ringed by their score band, with a
legend. A stored `mapLayer` of `"health"`, a saved view with it, and an old
`?layer=health` link all read as Pins. The server maps the value in
`userPreferencesService` (a zod preprocess) and in `mapViewService`, so an
old value never fails to load and a save from a page loaded before v2 is
stored as `"pins"`.

#### Saved Views

Users can save their current viewport bounds, active filter query, and selected layer to return to them anytime or share the link with colleagues.

- **Storage and Multi-Tenancy**: Saved views are stored in the `map_views` table with strict owner isolation, index seeks, and owner purge cascade. Accounts are capped at 100 views, returning `409 TOO_MANY_VIEWS` beyond that limit.
- **Views Menu**: A dropdown in the map toolbar lists saved views, highlights the active view, and provides quick actions to rename or delete views.
- **Saving a View**: Clicking "Save current view…" opens a modal dialog to name the view. View coordinates are normalized and validated before storage.
- **Restoring a View**: Selecting a saved view smoothly fits the viewport to its saved bounds (or uses `jumpTo` when reduced motion is preferred), applies its search filter query, and sets the active layer.
- **URL Coordination**: While a saved view is active, the URL contains `?view=<id>`. When the map loads, a `?view=` parameter takes precedence over the locally remembered camera in `lastView.ts`. Modifying search filters or changing layers clears the active view ID and switches back to `?q=` and `?layer=`.

### Light and Dark Basemaps

The map loads one style per palette:

| Palette | Default style                                   |
| ------- | ----------------------------------------------- |
| Light   | `https://tiles.openfreemap.org/styles/positron` |
| Dark    | `https://tiles.openfreemap.org/styles/dark`     |

The basemap colours come from the style file, not from the app's colour
tokens. A light basemap inside a dark app is a bright rectangle in the middle
of the page. `src/views/map/mapStyles.ts` also names `liberty`, `bright` and
`fiord`, which are one-line alternatives.

### Map Overlay Detail

When you click a contact on the map, their profile slides in from the right as an overlay:

- The route becomes `/map/contact/:id`, so the open contact is in the URL
- Full contact detail view (same as the Network view)
- Animated entry with spring physics
- Responsive width (full on mobile, 760px on tablet, 860px on desktop)
- The map treats the overlay as a cover, and keeps the pin in the part of
  the map it leaves open (see the next section)

### Fly to the Open Contact

`/map/contact/<id>` centres the map on that contact. The move takes 800 ms
and stops at zoom 11, close enough to read the streets around the pin. A map
already closer than that keeps its zoom, so opening a second contact in the
same street does not pull the view back.

"Centred" means centred in the part of the map you can see. The open
contact covers the right of the map on a wide screen, and a pin centred in
the whole map would sit under it. So the map measures what covers it and
passes the cover to MapLibre as padding, and the pin lands in the middle of
the open part, beside the contact. When the contact closes, the padding eases
away over the 400 ms of the contact's slide, and the pin glides to the middle
of the whole map.

The covers are found by an attribute, not by a width copied from a class
name. The contact overlay carries `data-covers-map="right"` and the phone's
tab bar carries `data-covers-map="bottom"`. `src/views/map/insets.ts`
measures both. A cover that leaves less than 240 px of open map is treated as
the whole map: on a phone the contact covers the map edge to edge, and the
pin is centred for the moment the contact closes.

The move waits for the map's load event. It never runs at mount, because the
view a map is born with is a creation prop, and an animation started before
the map has a style leaves every pin in the wrong place. See the header of
`src/views/map/ContactMap.tsx`.

A reader who set "reduce motion" in their system gets the same view with
`jumpTo` and no animation (WCAG 2.3.3). `src/views/map/flyTo.ts` holds both
paths and the one decision between them.

### The Map Remembers Where You Left It

The map writes its view to `localStorage` each time a move ends, under
`contrack.map.lastView`, and opens on that view the next time: after a visit
to another page, and after a reload. A first visit opens on the world. The
value is a fact about this browser and your last look, not a setting of the
account, so it does not travel between devices. A value that is not a view
reads as no view, and the map opens on its default.

The read is synchronous and happens before the map exists, so the remembered
view is a creation prop like the zoom and the bounds. Nothing animates into
it. `src/views/map/lastView.ts` holds the read, the write and the check.

### The Map Stays Warm Between Visits

Leaving the map page does not destroy the map. `@vis.gl/react-maplibre` keeps the map
instance, with its style, its tiles and its worker, and hands it back when
the page mounts again. A return to the map shows it at once, where you left
it, with no style fetch and no tile fetch. One map is kept, and only the page
map asks for it: the still map on a contact and the map in the Adjust pin
dialog are born with other options and are destroyed when they close.

The map's code is warmed too. MapLibre is the largest chunk in the build,
and only the map loads it, so the first visit to the map would otherwise
begin with a download. An idle moment on whichever page opens first fetches
it instead. A browser that asks to save data is left alone. See
[Performance](#performance).

### Attribution

MapLibre draws the basemap's credit in the bottom right corner, as a compact
"i" button. MapLibre opens it expanded on load and collapses it on the first
drag. Here it opens collapsed. The credit the basemap's terms require is one
click away, where MapLibre puts it after a drag.

On the map page the "i" sits on top of the zoom buttons, and the credit it
opens is a card no wider than 13rem that wraps its words. At the foot of the
column it opened across the bottom of the map, over the bottom line at 800
and 1024 px. A pointer click on the
"i" or a zoom button draws no focus glow. Focus from the keyboard draws the
app's ring: inset on a zoom button, and 2 px outside the credit's pill.

### On a Phone

- A tap on a pin opens the contact. No hover card opens, because a finger
  cannot hover (see [Hover Card](#hover-card)).
- The contact covers the whole map. When it closes, the pin is in the
  middle of the map above the tab bar, because the bar is one of the covers
  the map measures.
- The map does not rotate. Two fingers rotate a MapLibre map by default, and
  so do Shift and the arrow keys, and there is no compass here to put north
  back at the top. Both rotation handlers are off. Pinch still zooms, the
  arrow keys still pan.
- The zoom buttons grow to 44 px and sit above the tab bar with the
  attribution.

---

## The Map on a Contact

A contact's Details card shows where that person is, under their addresses.

| The contact has            | What the card shows                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| Coordinates                | A 160 px still map with their pin, then "Open in map" and "Adjust pin" |
| An address, no coordinates | The line "Not on the map yet", and "Set location"                      |
| Neither                    | Nothing                                                                |

A pin a person placed also shows a "Placed by hand" badge, with an InfoTip
that says the geocoder will not move it. "Adjust pin" and "Set location" open
the dialog described in [Moving a Pin by Hand](#moving-a-pin-by-hand).

Each address row's menu also holds **Show on map** when the contact has
coordinates. Every one leads to `/map/contact/<id>`, because a contact has
one pin however many addresses they have. The first address is the one that
places it, and its row says **Map pin**.

The mini map is `ContactMap` with `interactive={false}`, one pin, no hover
card, and `label="Location map"`. It is a still picture: it answers "is this
pin in the right place?" and hands every other question to the map page.

Four rules keep it cheap and quiet. A contact page is built fresh for each
person, so without them a reader moving down the list pays for a new WebGL
canvas, a new style to parse and a new set of tiles, for every person they
pass and throw away:

- **The map arrives only when there is a pin to draw.** `LocationMiniMap`
  loads `ContactMap` with `React.lazy`, from the chunk the map page uses. A
  contact with no coordinates loads no map code.
- **It waits for the pin to hold still.** The map is built only once the same
  place has been on screen for `SETTLE_MS` (250 ms). Step through the list
  with the arrow keys and no map is built for anybody passed through. Editing
  an address moves the pin, which starts the wait again.
- **It arrives once.** The frame holds a still panel in the container colour
  from the first frame. The map is laid over it and fades up over 300 ms once
  it reports that it has loaded, so the empty canvas and the tiles painting
  in are never on screen. The panel does not pulse: a pulse repeated for
  every contact is the flicker it was meant to cover.
- **The picture stands down on the map page.** On `/map/contact/<id>` the
  map behind the panel already holds the pin, so a second canvas and a second
  pin with the same name would be waste and noise, and "Open in map" would
  lead where the reader already is. "Adjust pin" and the badge stay, because
  a wrong pin is most visible from the map.

### MapLibre's own chrome

Every `ContactMap` hides the attribution and the zoom buttons until the map
has loaded, through `data-map-ready` on the wrapper and one rule in
`index.css`. MapLibre's compact attribution control is born expanded: the
moment a style's attributions arrive it lays the full credit strip across the
map, and it stays until something collapses it. `ContactMap` collapses it,
but only on load, so the strip flashed over every map that opened. The class
the strip carries cannot tell that state from the one a reader opens with the
"i" button, so CSS covers the one moment it is wrong. The credit the
basemap's terms require is behind the "i" from the first frame anybody sees,
which is where MapLibre itself leaves it after a drag.

---

## Moving a Pin by Hand

The geocoder reads an address and places a pin, and sometimes it reads wrong:
the other Springfield, the office instead of the house, a street two cities
share. The fix needs no API and no key. A person moves the pin.

"Adjust pin" under the mini map opens a dialog with an interactive map, 480 px
tall, centred on the pin at zoom 11. The pin is the contact's avatar, and it
moves three ways:

- **Drag it.** The pin follows the pointer and lands where the pointer lets
  go.
- **Tap or click the map.** The pin jumps to the tap or the click.
- **Focus the pin and press an arrow key.** Each key moves the pin 10 pixels
  on the screen, or 50 with Shift. The step is in pixels, so a nudge is the
  same size at every zoom, and the map does not pan with it.

The coordinates show under the map as text, latitude first, to five decimals.
The line is a live region, so a screen reader hears the new position after a
move. Nothing is written until **Save**, which is off until the pin has moved.
**Cancel** closes the dialog and the pin stays where it was.

"Set location" opens the same dialog for a contact the geocoder could not
place. The map opens on the world, there is no pin until the first click, and
Save is off until then.

### Who placed the pin

Every contact carries `geoSource`: `'geocoder'` when the geocoder read the
address into the coordinates, `'manual'` when a person placed the pin, and
null before either, or when the coordinates arrived with the contact. The
contact page shows "Placed by hand" for a `'manual'` pin.

The geocoder never overwrites a `'manual'` row. That guard is in the write
itself, so a geocode queued before the pin was moved lands on nothing when it
runs. The startup sweep leaves such a row alone. An edit to the contact asks
the geocoder again only when it changes the address the pin stands for: the
primary address row when there are rows, else the `location` field. That
edit clears `geoSource` and queues the geocoder. The old coordinates stand
until it answers.

### Use address again

The third button in the dialog hands the pin back. The server clears the
coordinates and `geoSource` and queues the geocoder on the same address text
it read the first time. A cached answer lands before the dialog closes. A new
one lands when the queue drains, and until then the contact reads "Not on the
map yet".

### API

`PATCH /api/contacts/:id/location` takes `{ "lat": -33.9, "lng": 151.3 }` or
`{ "regeocode": true }`, and nothing else. Latitude must be in [-90, 90] and
longitude in [-180, 180]. The answer is the whole contact. A contact in the
trash, or another account's, answers 404 with the same body as an unknown id.
See [API Reference](../api-reference.md#patch-apicontactsidlocation).

---

## Where the Data Comes From

`GET /api/contacts/map` returns one row per placed contact:

```
id, name, company, avatarUrl, location, lat, lng, geoSource
```

The route returns only contacts with valid `lat` and `lng` coordinates. It
leaves out archived contacts, trashed contacts, ghost contacts and every other
account's contacts.

`shared/geo.ts` holds what the server and the browser both read: the
`MapContact` and `MapStyleUrls` types, `isValidLatLng`, and
`toFeatureCollection`, which turns the rows into the GeoJSON the map source
reads.

---

## Geocoding

Contrack automatically geocodes contact addresses to latitude/longitude coordinates.

### Provider

Nominatim (OpenStreetMap) is the one geocoder. It is free and needs no API
key. Its usage policy allows at most one request a second, so the background
queue waits 1.1 s between requests. Every answer is cached in `geocode_cache`,
and an address that found nothing is not tried again for seven days.

### How It Works

1. When a contact's address is created or updated, a geocoding job fires in the background
2. The geocoder resolves the address to lat/lng coordinates
3. Coordinates are stored on the contact record (`lat`, `lng` columns), and
   `geoSource` is set to `'geocoder'`
4. The contact appears on the map at the next page load

A pin a person placed (`geoSource = 'manual'`) is never overwritten by the
geocoder. See [Who placed the pin](#who-placed-the-pin).

### Retroactive Geocoding

On server startup, Contrack scans for contacts with addresses but no coordinates and geocodes them in the background. This is non-blocking, and the app is fully usable during geocoding. A pin placed by hand is left out of the scan.

---

## Configuration

### Basemap

Two environment variables name the style each palette loads:

| Variable          | Description                     | Default                                         |
| ----------------- | ------------------------------- | ----------------------------------------------- |
| `MAP_STYLE_LIGHT` | Basemap style for the light app | `https://tiles.openfreemap.org/styles/positron` |
| `MAP_STYLE_DARK`  | Basemap style for the dark app  | `https://tiles.openfreemap.org/styles/dark`     |

A value is either an absolute `https://` URL, or a root-relative path such as
`/map/style.json`, which is a style this app serves from `public/`. An invalid
value writes one warning to the log, and the map loads the default instead.

`server/utils/mapConfig.ts` reads both variables. It is the one place the
answer comes from. `GET /api/auth/status` reports the result as `map`, and the
client reads it through `useAuth()`.

### Content Security Policy

With `NODE_ENV=production` the server sends a Content-Security-Policy that
`buildProductionCsp()` in `server/app.ts` builds. For the map it adds:

- `worker-src 'self' blob:` and `child-src blob:`, because MapLibre parses
  tiles on a worker
- The origin of each style URL, in `connect-src`, because the style, the
  tiles, the glyphs and the sprite all load through `fetch`

A root-relative style is same-origin and adds nothing to the header. That is
what makes a self-hosted basemap a configuration change and not a code change.

### Self-hosted and offline basemaps

The default basemap comes from OpenFreeMap over the network. An instance on a
private network, or one that must not depend on a public host, can serve its
own basemap from this app's `public/` folder. Nothing in the code changes.
Three kinds of file and one setting do it.

Contrack registers the `pmtiles://` protocol when the map loads, so a style
can point one source at a single `.pmtiles` archive and no tile server is
needed. A PMTiles archive is one file that holds every tile with an index at
the front, and the browser reads tiles out of it with HTTP range requests,
which this server answers for anything under `public/`.

**1. The tiles, as one archive.** Get a planet build from
[Protomaps](https://maps.protomaps.com/builds/) and cut it to the area you
need with the `pmtiles` command line tool. The box is west, south, east,
north. A city is a few hundred megabytes. The planet is about 100 GB.

```bash
pmtiles extract https://build.protomaps.com/20260901.pmtiles \
  public/map/area.pmtiles --bbox=-0.6,51.2,0.4,51.8
```

**2. The glyphs and the sprite.** A vector style draws labels from font glyph
files and icons from a sprite. Copy the `fonts/` and `sprites/` folders from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
into `public/map/`.

**3. The style**, at `public/map/style.json`. The source names the archive
with the `pmtiles://` protocol and a root-relative path. The layers below are
the smallest useful set for the Protomaps schema. The
[`@protomaps/basemaps`](https://www.npmjs.com/package/@protomaps/basemaps)
package generates the full set for a named theme.

```json
{
  "version": 8,
  "glyphs": "/map/fonts/{fontstack}/{range}.pbf",
  "sprite": "/map/sprites/v4/light",
  "sources": {
    "protomaps": {
      "type": "vector",
      "url": "pmtiles:///map/area.pmtiles",
      "attribution": "<a href=\"https://protomaps.com\">Protomaps</a> © <a href=\"https://openstreetmap.org\">OpenStreetMap</a>"
    }
  },
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": { "background-color": "#f4f2ee" }
    },
    {
      "id": "water",
      "type": "fill",
      "source": "protomaps",
      "source-layer": "water",
      "paint": { "fill-color": "#cfe0f0" }
    },
    {
      "id": "roads",
      "type": "line",
      "source": "protomaps",
      "source-layer": "roads",
      "paint": { "line-color": "#ffffff", "line-width": 1 }
    },
    {
      "id": "places",
      "type": "symbol",
      "source": "protomaps",
      "source-layer": "places",
      "layout": {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12
      }
    }
  ]
}
```

**4. The setting.** Point one palette or both at the file and restart:

```
MAP_STYLE_LIGHT="/map/style.json"
MAP_STYLE_DARK="/map/style-dark.json"
```

`GET /api/auth/status` then reports `map.light` as `/map/style.json`, the
client asks this origin for it, and the production CSP lets the fetch through
because the origin is `'self'`. No request leaves the instance. Open `/map`
and watch the network panel: `/map/style.json` answers 200, and
`/map/area.pmtiles` answers 206 to each range request.

Two things to know:

- `public/` is copied into `dist/` at build time, so a file added after the
  build goes under `dist/map/` on a running instance. With Docker, mount the
  folder at `/app/dist/map`.
- A style on another host needs that host in `connect-src`. The server adds
  it when the style URL is absolute. Tiles, glyphs or a sprite on a third
  host are the operator's to serve from the style's host, or from here.

---

## Performance

What makes the map fast to open, in the order a visit meets it:

1. **The map's code is on the map alone.** The build puts MapLibre,
   react-maplibre and PMTiles in one chunk, `vendor-maplibre`, and React in
   its own, `vendor-react`. Every page preloads React. Only the map, the
   still map on a contact and the Adjust pin dialog load MapLibre. Before
   this split, React and Vite's own preload helper were folded into the map's
   chunk, and every page preloaded a megabyte of MapLibre to get them. The
   groups are in `vite.config.ts`.
2. **The chunk is warmed while you read something else.** `src/App.tsx`
   asks for an idle moment after the first page settles and fetches the map's
   code then, so the first visit to the map does not start with a download.
   `src/lib/idle.ts` skips the fetch when the browser asks to save data.
3. **The map opens where you left it.** No flight from the world to your
   city on every visit. See
   [The Map Remembers Where You Left It](#the-map-remembers-where-you-left-it).
4. **The map is kept between visits.** A return to the page reuses the map
   instance, tiles and all. See
   [The Map Stays Warm Between Visits](#the-map-stays-warm-between-visits).
5. **The contacts are cached.** `GET /api/contacts/map` is a React Query
   with a five minute stale time, so a return to the map draws the pins from
   the cache while the answer refreshes.
6. **The basemap is cached by the browser.** OpenFreeMap sends long cache
   headers on its style, sprite, glyphs and tiles.

---

## Accessibility

- The map container is a region named "Contact map", and the mini map on a
  contact is a region named "Location map"
- The page carries a visually hidden `h1`, "Map"
- Every pin is a real `<button>` named `"<name>, <company>"`
- Every cluster is a real `<button>` named `"<n> contacts, <m> at risk, zoom in"`
- Tab reaches a pin, focus from a keyboard opens its hover card on any
  device, and Enter opens the contact
- The bottom line is a region named "In view" with a polite live region, so a screen reader hears who is in view after a move. Overdue is a toggle button with `aria-pressed`
- The Insights button is a disclosure (`aria-expanded`, `aria-controls`) named "Map insights". The panel is a landmark with the same name, `inert` while closed, with its heading kept for a screen reader, and its Summary and People views are a `Segmented` radio group
- The zoom buttons sit in MapLibre's navigation control
- In the Adjust pin dialog the pin is a `<button>` that the arrow keys move,
  and the coordinates line is a live region, so the dialog works with no
  pointer at all

The markers are React components, so an avatar URL never passes through
`innerHTML` and no marker carries an inline event handler attribute.

`tests/e2e/axe.spec.ts` waits for the "Contact map" region and a named pin,
then scans the page. Its contact scan waits for the "Location map" region and
its pin for the same reason. `tests/e2e/map.spec.ts` scans the page again
with the Adjust pin dialog open. `tests/e2e/metrics.spec.ts` scans `/map` on
a 390 pixel phone for the tap-target and text-size floors. See
[Accessibility](../accessibility.md).

---

## Keyboard Shortcuts

| Shortcut  | Description                                          |
| --------- | ---------------------------------------------------- |
| `/`       | Focus the map filter search input                    |
| `F`       | Fit all matching contacts within the viewport        |
| `i` / `I` | Open or close the map insights panel                 |
| `L`       | Activate freehand lasso selection mode               |
| `Space`   | Pin hover card into dialog mode when pin is focused  |
| `Escape`  | Close card or clear selection or dismiss modal sheet |

---

## Screenshots

### Map Stats and Insights

| View               | Mode  | Screenshot                                         |
| ------------------ | ----- | -------------------------------------------------- |
| Desktop (1440x900) | Light | `docs/screenshots/map-stats/map-desktop-light.png` |
| Desktop (1440x900) | Dark  | `docs/screenshots/map-stats/map-desktop-dark.png`  |
| Phone (390x844)    | Light | `docs/screenshots/map-stats/map-phone-light.png`   |
| Phone (390x844)    | Dark  | `docs/screenshots/map-stats/map-phone-dark.png`    |

---

## API

```bash
# Fetch all geocoded contacts
curl http://localhost:3210/api/contacts/map

# Put a pin where a person dropped it
curl -X PATCH http://localhost:3210/api/contacts/abc123/location \
  -H "Content-Type: application/json" \
  -d '{"lat": -33.9, "lng": 151.3}'

# Hand the pin back to the geocoder
curl -X PATCH http://localhost:3210/api/contacts/abc123/location \
  -H "Content-Type: application/json" \
  -d '{"regeocode": true}'
```

The first returns only contacts with valid `lat` and `lng` coordinates. The
other two return the whole contact.
