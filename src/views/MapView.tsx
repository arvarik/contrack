import React from 'react';
import { MapContainer, TileLayer, Marker, ZoomControl } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import { useMapContacts } from '../api';
import L from 'leaflet';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Map icon factories — uses the app's primary blue (#009EDB) for consistency
// ---------------------------------------------------------------------------

const PRIMARY_COLOR = '#009EDB';
const SURFACE_BG = '#f8fafb';

/**
 * Creates a Leaflet DivIcon with the contact's avatar photo.
 * Uses the app's primary colour for the border ring for visual consistency.
 */
const createCustomIcon = (avatarUrl: string) => {
  return L.divIcon({
    className: 'custom-avatar-icon bg-transparent border-none outline-none',
    html: `
      <div style="width: 48px; height: 48px; border-radius: 50%; border: 3px solid ${PRIMARY_COLOR}; overflow: hidden; background: ${SURFACE_BG}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform: translate(-50%, -50%); transition: transform 0.2s;" onMouseOver="this.style.transform='translate(-50%, -60%)'" onMouseOut="this.style.transform='translate(-50%, -50%)'">
        <img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
      </div>
    `,
    iconSize: [0, 0], // Offset handled by transform in the inner div
  });
};

/**
 * Creates a cluster icon showing the count of grouped contacts.
 * Uses the app's primary colour for the badge.
 */
const createClusterCustomIcon = function (cluster: any) {
  return L.divIcon({
    html: `
      <div style="width: 48px; height: 48px; border-radius: 50%; border: 3px solid ${PRIMARY_COLOR}; background: ${SURFACE_BG}; display: flex; align-items: center; justify-content: center; font-weight: 800; color: ${PRIMARY_COLOR}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-size: 1.2rem;">
        ${cluster.getChildCount()}
      </div>
    `,
    className: 'custom-cluster-icon bg-transparent border-none outline-none',
    iconSize: L.point(48, 48, true),
  });
};

// ---------------------------------------------------------------------------
// MapView — Leaflet-based geospatial explorer for contacts
// ---------------------------------------------------------------------------

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
  const navigate = useNavigate();

  return (
    <div className="w-full h-full relative bg-surface-container-lowest z-0">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-surface/50 backdrop-blur-sm">
           <span className="text-primary font-bold animate-pulse">Scanning geospatial data...</span>
        </div>
      )}
      <MapContainer 
        center={[20, 0]} 
        zoom={2} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', background: '#f0f4f6' }}
        zoomControl={false}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
        >
          {contacts.map((contact) => (
            <Marker 
               key={contact.id}
               position={[contact.lat, contact.lng]}
               icon={createCustomIcon(contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name || '')}`)}
               eventHandlers={{
                 click: () => {
                   navigate(`/map/contact/${contact.id}`);
                 }
               }}
            />
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
};
