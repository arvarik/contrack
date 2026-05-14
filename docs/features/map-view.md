# Map View

Contrack's Map View displays your contacts on an interactive, clustered map — visualizing your network geographically.

Access via the **Map** tab in the navigation or `Cmd+Shift+M`.

<!-- Screenshot: map-view.png -->

## Features

### Cluster Markers

Contacts are grouped into clusters using React Leaflet Cluster. As you zoom in:

- Large clusters break into smaller groups
- Individual pins appear at high zoom levels
- Cluster badges show the number of contacts in each group

### Contact Pins

Each pin on the map represents a geocoded contact:

- Click a pin to open the contact's detail panel as a slide-over overlay
- The overlay supports full profile editing, timeline viewing, and interaction logging
- Press `Escape` or click outside to close

### Map Overlay Detail

When you click a contact on the map, their profile slides in from the right as an overlay:

- Full contact detail view (same as the Network view)
- Animated entry with spring physics
- Responsive width (full on mobile, 760px on tablet, 860px on desktop)

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

On server startup, Contrack scans for contacts with addresses but no coordinates and geocodes them in the background. This is non-blocking — the app is fully usable during geocoding.

---

## Configuration

To enable Mapbox geocoding (recommended for accuracy):

```
MAPBOX_API_KEY="your-mapbox-token"
```

Without Mapbox, Nominatim (OpenStreetMap) is used. Nominatim is free but has rate limits and lower accuracy for ambiguous addresses.

---

## API

```bash
# Fetch all geocoded contacts
curl http://localhost:3000/api/contacts/map
```

Returns only contacts with valid `lat` and `lng` coordinates.
