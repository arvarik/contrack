/**
 * MapView — Leaflet-based geospatial explorer for contacts.
 *
 * Renders geocoded contacts on a world map with clustered avatar markers.
 * Clicking a marker navigates to the contact detail overlay within the map context.
 */
import React, { useMemo, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  ZoomControl,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import { useMapContacts } from "../api";
import L from "leaflet";
import { useNavigate, useLocation } from "react-router-dom";
import { fallbackAvatarUrl } from "../lib/avatar";
import { escapeHtml } from "../lib/utils";
import { usePageTitle } from "../hooks/usePageTitle";
import { buttonLike } from "../lib/a11y";

/**
 * Keeps the world filling the window, whatever the window is.
 *
 * Leaflet's world is a square: at zoom z it is 256 * 2^z pixels tall, and
 * Mercator stops at ±85° latitude, so there is nothing to draw beyond it. On a
 * tall desktop window at the default zoom 2 the world is 1024px high and the
 * remaining height is empty background above and below the map. Zooming out
 * makes it worse, not better.
 *
 * So the minimum zoom is not a constant, it is a function of the viewport:
 * the smallest z where 256 * 2^z covers the container's LARGER dimension.
 * Recomputed on resize, because the same browser is a different device once
 * you drag the window or turn a tablet sideways.
 *
 * Width MUST be part of the calculation, and the first version of this code
 * got that wrong. It reasoned "Leaflet repeats tiles horizontally, so a wide
 * window shows more copies of the world rather than empty space" — true for
 * TILES, false for MARKERS, which render exactly once at their canonical
 * longitude. On a desktop wider than the world (2560px window, zoom 3 world =
 * 2048px) the sides filled with wrapped continent copies that carry no pins,
 * and maxBounds clamped the center back to longitude 0 — so the user saw a
 * USA with its pins one world-copy away, sitting in the ocean. Covering the
 * width means one world copy fills the view and every continent on screen is
 * the one the pins live on. noWrap on the tile layer is the second half of
 * the same guarantee: wrapped copies never render at all.
 */
/** The full Mercator world. Latitude stops at ±85.05°; there is no map past it. */
const WORLD_BOUNDS = L.latLngBounds(
  L.latLng(-85.05112878, -180),
  L.latLng(85.05112878, 180),
);

const FitWorldToViewport = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const apply = () => {
      const height = container.clientHeight;
      const width = container.clientWidth;
      if (!height || !width) return;

      const TILE_SIZE = 256;
      // The world must cover BOTH dimensions — see the header comment for
      // the marker-displacement bug that height-only produced.
      const needed = Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE));
      // Never below Leaflet's own floor, and never so deep that the whole
      // world stops being reachable on a very large screen.
      const minZoom = Math.max(0, Math.min(needed, 5));

      if (map.getMinZoom() !== minZoom) map.setMinZoom(minZoom);
      if (map.getZoom() < minZoom) map.setZoom(minZoom);

      // A large enough world is necessary but not sufficient. The view starts
      // at latitude 20 and the user can drag, so a 1024px world in a 1000px
      // window still showed a 46px band of background at the top. Locking the
      // view to the world's own bounds removes the last gap and stops anyone
      // dragging the map off the edge of itself.
      map.setMaxBounds(WORLD_BOUNDS);
      // The container's pixel size changed under Leaflet; without this it
      // keeps rendering at the old size and leaves a grey band.
      map.invalidateSize();
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
};

const MapClickHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();
  useMapEvents({
    click: () => {
      if (location.pathname.startsWith("/map/contact/")) {
        navigate("/map");
      }
    },
  });
  return null;
};

// ---------------------------------------------------------------------------
// Map icon factories — uses CSS variable tokens for design system consistency
// ---------------------------------------------------------------------------

const PRIMARY_COLOR = "var(--color-primary)";
const SURFACE_BG = "var(--color-surface-container-lowest)";

/**
 * Only allow http(s) URLs or same-origin relative paths as avatar sources.
 * Anything else (javascript:, data:, etc.) falls back to a generated avatar.
 */
const isSafeAvatarUrl = (url: string): boolean => {
  if (url.startsWith("/")) return true;
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Creates a Leaflet DivIcon with the contact's avatar photo.
 * Uses the app's primary colour for the border ring for visual consistency.
 *
 * Security: the avatar URL is scheme-validated and HTML-escaped before being
 * interpolated into the divIcon markup (L.divIcon renders via innerHTML).
 */
const createCustomIcon = (avatarUrl: string, contactName: string) => {
  const validatedUrl = isSafeAvatarUrl(avatarUrl)
    ? avatarUrl
    : fallbackAvatarUrl(contactName);
  return L.divIcon({
    className: "custom-avatar-icon bg-transparent border-none outline-none",
    html: `
      <div style="width: 48px; height: 48px; border-radius: 50%; border: 3px solid ${PRIMARY_COLOR}; overflow: hidden; background: ${SURFACE_BG}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform: translate(-50%, -50%); transition: transform 0.2s;" onMouseOver="this.style.transform='translate(-50%, -60%)'" onMouseOut="this.style.transform='translate(-50%, -50%)'">
        <img src="${escapeHtml(validatedUrl)}" style="width: 100%; height: 100%; object-fit: cover;" />
      </div>
    `,
    iconSize: [0, 0], // Offset handled by transform in the inner div
  });
};

/**
 * Creates a cluster icon showing the count of grouped contacts.
 * Uses the app's primary colour for the badge.
 */
// Minimal structural type — react-leaflet-cluster's own typings use `any`.
const createClusterCustomIcon = function (cluster: {
  getChildCount(): number;
}) {
  return L.divIcon({
    html: `
      <div style="width: 48px; height: 48px; border-radius: 50%; border: 3px solid ${PRIMARY_COLOR}; background: ${SURFACE_BG}; display: flex; align-items: center; justify-content: center; font-weight: 800; color: ${PRIMARY_COLOR}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-size: 1.2rem;">
        ${cluster.getChildCount()}
      </div>
    `,
    className: "custom-cluster-icon bg-transparent border-none outline-none",
    iconSize: L.point(48, 48, true),
  });
};

// ---------------------------------------------------------------------------
// MapView — Leaflet-based geospatial explorer for contacts
// ---------------------------------------------------------------------------

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
  const navigate = useNavigate();

  usePageTitle("Map");

  // Memoize marker icons per avatar URL so a fresh L.divIcon isn't minted
  // for every contact on every render.
  const markerIcons = useMemo(() => {
    const cache = new Map<string, L.DivIcon>();
    for (const contact of contacts) {
      const url = contact.avatarUrl || fallbackAvatarUrl(contact.name || "");
      if (!cache.has(url)) {
        cache.set(url, createCustomIcon(url, contact.name || ""));
      }
    }
    return cache;
  }, [contacts]);

  return (
    <div className="w-full h-full relative bg-surface-container-lowest z-0">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-surface/50 backdrop-blur-sm">
          <span className="text-primary font-bold animate-pulse">
            Scanning geospatial data...
          </span>
        </div>
      )}
      <MapContainer
        // Opens over the Americas rather than the Atlantic. Longitude 0 put
        // the prime meridian in the middle of the screen, which shows Africa
        // and Europe first and pushes the Americas to the left edge.
        center={[20, -95]}
        zoom={2}
        scrollWheelZoom={true}
        style={{
          height: "100%",
          width: "100%",
          background: "var(--color-surface-container-low)",
        }}
        zoomControl={false}
        // Makes the maxBounds set in FitWorldToViewport a hard edge rather than
        // an elastic one, so a drag cannot expose background behind the world.
        maxBoundsViscosity={1.0}
      >
        <FitWorldToViewport />
        <MapClickHandler />
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          // Never draw wrapped world copies: markers render only on the
          // canonical copy, so a wrapped continent is a continent with its
          // pins missing — which reads as "my contacts are in the ocean".
          noWrap
        />

        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          showCoverageOnHover={false}
          spiderLegPolylineOptions={{ weight: 0, opacity: 0 }}
        >
          {contacts.map((contact) => (
            <Marker
              key={contact.id}
              position={[contact.lat, contact.lng]}
              icon={markerIcons.get(
                contact.avatarUrl || fallbackAvatarUrl(contact.name || ""),
              )}
              eventHandlers={{
                click: () => navigate(`/map/contact/${contact.id}`),
                mouseover: (e) => e.target.openPopup(),
                mouseout: (e) => e.target.closePopup(),
              }}
            >
              {/* Popup clarifies which location is pinned when a contact has
                  multiple addresses — hover the pin to see before navigating */}
              <Popup closeButton={false} offset={[0, -24]}>
                <div
                  {...buttonLike(() => navigate(`/map/contact/${contact.id}`))}
                  style={{
                    fontFamily: "var(--font-body)",
                    padding: "4px 8px",
                    cursor: "pointer",
                  }}
                >
                  <p
                    style={{
                      fontWeight: 800,
                      fontSize: "14px",
                      color: "var(--color-on-surface)",
                      margin: "0 0 2px",
                    }}
                  >
                    {contact.name}
                  </p>
                  {contact.company && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--color-on-surface-variant)",
                        margin: "0 0 2px",
                      }}
                    >
                      {contact.company}
                    </p>
                  )}
                  {contact.location && (
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--color-primary)",
                        fontWeight: 600,
                        margin: "0",
                      }}
                    >
                      📍 {contact.location}
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
};
