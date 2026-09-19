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
- `near:<place>/<km>` (default 25 km, e.g. `near:London/50km` or `near:Paris`). While resolving, the pill shows `resolving…` and matches all contacts; pressing `Enter` resolves the place's coordinates via `GET /api/geo/search` and applies client-side haversine distance filtering. A failed resolution displays the pill in error styling.
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
- Cluster badges show the number of contacts in each group
- An outer SVG ring renders a proportional red error arc when the cluster contains at-risk contacts (health score < 40)

A cluster is a button named `"<n> contacts, <m> at risk, zoom in"`. A click zooms to the
level where that cluster splits.

Some clusters never split. The geocoder gives every contact in one city the
same coordinates, so their pins sit on one point at every zoom. A click on
such a cluster opens a list of the people instead, up to fifty of them, and
each name in the list is a button. Escape closes the list. A stacked pin stays
reachable this way.

### Stats Strip

Floating at the bottom-left corner of the map, the **Stats Strip** aggregates live metrics for contacts currently in the viewport (debounced 150ms on camera movement):

- **In view**: Count of contacts placed within the visible bounding box.
- **At risk**: Count of contacts with health scores < 40. Clicking this chip appends `score:<40` to the active search filter.
- **Overdue**: Count of contacts past their follow-up cadence. Clicking this chip filters by overdue contacts.
- **Average score**: Mean relationship health score of in-view contacts.
- **Time zones**: Number of distinct time zones spanned by in-view contacts.

When no contacts fall within the visible bounds, the strip displays a compact empty state ("No contacts in this area") with a **Fit all** button. Updates to the strip are announced to screen readers via an accessible live status region (`role="status"`).

### Map Insights Pane

A dedicated insights drawer slides in from the right edge on desktop (320px wide) or opens as an accessible modal sheet on mobile:

- **Desktop & Mobile**: Toggled via the **Insights** toolbar button or keyboard shortcut `i` / `I`. Its open/closed state on desktop persists across visits through the `mapPaneOpen` account preference (defaults to `true`).
- **Map Control Insets**: The drawer carries `data-covers-map="right"`, automatically offsetting MapLibre's zoom and attribution controls on wide viewports (`@media (min-width: 1024px)`) so they stay completely visible and unobstructed.
- **Tabs**:
  - **Stats Tab**: Displays summary cards (In view, Avg score, At risk, Overdue) and horizontal distribution bar charts for **Top Industries**, **Top Companies**, and **Top Tags**. Clicking any bar immediately filters the map by that facet. Also lists the distinct time zones present in the viewport.
  - **People Tab**: A virtualized list (powered by `@tanstack/react-virtual`) showing all contacts currently in view, including their avatar, health score ring, name, company, and location. Clicking any contact in the list flies the map camera to their pin and opens their detail panel.

### Hover Card

Hover a pin or move focus to it, and a small card opens beside it. The card
shows the name, the company and the location that placed the pin. A contact
with several addresses is pinned by one of them, and the card names that one
before you navigate. The card closes when the pointer leaves or focus moves
away.

The card opens above every pin. A pin carries a z-index, so the open
contact's pin stands above its neighbours, and MapLibre gives its popup none.
`src/index.css` stacks the card above both, so a card never opens under the
next pin over. The card names no anchor: MapLibre opens it on the side with
room, so a pin at the top edge of the map gets its card below it instead of a
card cut off by the edge.

A finger cannot hover. A tap fires the same enter event a mouse does and
never the leave, so on a phone the card would open under the contact the tap
opens and still be there when the contact closes. The pin reads the pointer
type: a touch opens no card, and the focus some browsers give a tapped button
opens none either. Focus from a keyboard opens the card on every device.

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

Leaving the map page does not destroy the map. `react-map-gl` keeps the map
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

Two rules keep it cheap and quiet:

- **The map arrives only when there is a pin to draw.** `LocationMiniMap`
  loads `ContactMap` with `React.lazy`, from the chunk the map page uses. A
  contact with no coordinates loads no map code.
- **The picture stands down on the map page.** On `/map/contact/<id>` the
  map behind the panel already holds the pin, so a second canvas and a second
  pin with the same name would be waste and noise, and "Open in map" would
  lead where the reader already is. "Adjust pin" and the badge stay, because
  a wrong pin is most visible from the map.

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

### Providers

| Provider      | Priority                | Accuracy | API Key Required       |
| ------------- | ----------------------- | -------- | ---------------------- |
| **Mapbox**    | Primary (if configured) | High     | Yes (`MAPBOX_API_KEY`) |
| **Nominatim** | Fallback                | Medium   | No (free, no key)      |

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

### Mapbox Geocoding

To enable Mapbox geocoding (recommended for accuracy):

```
MAPBOX_API_KEY="your-mapbox-token"
```

Without Mapbox, Nominatim (OpenStreetMap) is used. Nominatim is free but has rate limits and lower accuracy for ambiguous addresses.

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
- The stats strip includes a live status announcement region (`role="status"`) so screen reader users hear viewport summary updates on camera movements
- Map insights pane tabs follow standard tab navigation, and virtualized contact rows support keyboard activation
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
| `i` / `I` | Toggle the Map insights pane open or closed          |
| `Escape`  | Close the open contact overlay or active modal sheet |

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
