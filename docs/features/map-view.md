# Map View

Contrack's Map View draws your contacts on an interactive, clustered map, so you can see your network geographically.

Access via the **Map** tab in the navigation or `Cmd+Shift+M`.

<!-- Screenshot: map-view.png -->

The map is MapLibre GL JS with vector tiles. The default basemap is
[OpenFreeMap](https://openfreemap.org/). It needs no API key, no registration
and no account. It sets no request limit and allows commercial use. MapLibre
draws the attribution on the map.

## Features

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

A cluster is a button named `"<n> contacts, zoom in"`. A click zooms to the
level where that cluster splits.

Some clusters never split. The geocoder gives every contact in one city the
same coordinates, so their pins sit on one point at every zoom. A click on
such a cluster opens a list of the people instead, up to fifty of them, and
each name in the list is a button. Escape closes the list. A stacked pin stays
reachable this way.

### Hover Card

Hover a pin or move focus to it, and a small card opens above it. The card
shows the name, the company and the location that placed the pin. A contact
with several addresses is pinned by one of them, and the card names that one
before you navigate. The card closes when the pointer leaves or focus moves
away.

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

### Fly to the Open Contact

`/map/contact/<id>` centres the map on that contact. The move takes 800 ms
and stops at zoom 11, close enough to read the streets around the pin. A map
already closer than that keeps its zoom, so opening a second contact in the
same street does not pull the view back.

The move waits for the map's load event. It never runs at mount, because the
view a map is born with is a creation prop, and an animation started before
the map has a style leaves every pin in the wrong place. See the header of
`src/views/map/ContactMap.tsx`.

A reader who set "reduce motion" in their system gets the same view with
`jumpTo` and no animation (WCAG 2.3.3). `src/views/map/flyTo.ts` holds both
paths and the one decision between them.

---

## The Map on a Contact

A contact's Details card shows where that person is, under their addresses.

| The contact has            | What the card shows                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| Coordinates                | A 160 px still map with their pin, then "Open in map" and "Adjust pin" |
| An address, no coordinates | The line "Not on the map yet", and "Set location"                      |
| Neither                    | Nothing                                                                |

"Adjust pin" and "Set location" are drawn but disabled. A later release wires
them to the manual pin. Each one carries an InfoTip that says so.

Each address row also shows a "Show on map" link when the contact has
coordinates. Every link leads to `/map/contact/<id>`, because a contact has
one pin however many addresses they have, and the first address is the one
that places it.

The mini map is `ContactMap` with `interactive={false}`, one pin, no hover
card, and `label="Location map"`. It is a still picture: it answers "is this
pin in the right place?" and hands every other question to the map page.

Two rules keep it cheap and quiet:

- **The map arrives only when there is a pin to draw.** `LocationMiniMap`
  loads `ContactMap` with `React.lazy`, from the chunk the map page uses. A
  contact with no coordinates loads no map code.
- **It stands down on the map page.** On `/map/contact/<id>` the map behind
  the panel already holds the pin, so a second canvas and a second pin with
  the same name would be waste and noise.

---

## Where the Data Comes From

`GET /api/contacts/map` returns one row per placed contact:

```
id, name, company, avatarUrl, location, lat, lng
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
3. Coordinates are stored on the contact record (`lat`, `lng` columns)
4. The contact appears on the map at the next page load

### Retroactive Geocoding

On server startup, Contrack scans for contacts with addresses but no coordinates and geocodes them in the background. This is non-blocking, and the app is fully usable during geocoding.

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

Contrack also registers the `pmtiles://` protocol when the map loads. A
self-hosted style can therefore point one source at a single `.pmtiles`
archive, with no tile server behind it. A worked example and an offline guide
come in a later release.

### Mapbox Geocoding

To enable Mapbox geocoding (recommended for accuracy):

```
MAPBOX_API_KEY="your-mapbox-token"
```

Without Mapbox, Nominatim (OpenStreetMap) is used. Nominatim is free but has rate limits and lower accuracy for ambiguous addresses.

---

## Accessibility

- The map container is a region named "Contact map", and the mini map on a
  contact is a region named "Location map"
- The page carries a visually hidden `h1`, "Map"
- Every pin is a real `<button>` named `"<name>, <company>"`
- Every cluster is a real `<button>` named `"<n> contacts, zoom in"`
- Tab reaches a pin, focus opens its hover card, and Enter opens the contact
- The zoom buttons sit in MapLibre's navigation control

The markers are React components, so an avatar URL never passes through
`innerHTML` and no marker carries an inline event handler attribute.

`tests/e2e/axe.spec.ts` waits for the "Contact map" region and a named pin,
then scans the page. Its contact scan waits for the "Location map" region and
its pin for the same reason. `tests/e2e/metrics.spec.ts` scans `/map` on a 390 pixel
phone for the tap-target and text-size floors. See
[Accessibility](../accessibility.md).

---

## Not in the map yet

One thing is planned and is deliberately absent today:

- Manual pin adjustment, for a contact the geocoder placed wrongly. The
  "Adjust pin" and "Set location" actions on a contact are drawn and
  disabled until then.

---

## API

```bash
# Fetch all geocoded contacts
curl http://localhost:3210/api/contacts/map
```

Returns only contacts with valid `lat` and `lng` coordinates.
