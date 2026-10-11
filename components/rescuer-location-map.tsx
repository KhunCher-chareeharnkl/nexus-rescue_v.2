'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export type RescuerMapMarker = {
  id: string;
  label: string;
  detail?: string | null;
  availability?: 'available' | 'busy' | 'offline' | null;
  assignmentStatus?: string | null;
  latitude: number;
  longitude: number;
  updatedAt?: string | null;
};

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center); }, [center, map]);
  return null;
}

function markerIcon(marker: RescuerMapMarker) {
  const color = marker.availability === 'busy' ? '#D92D20'
    : marker.availability === 'available' ? '#0466C8' : '#7D8597';
  return L.divIcon({
    className: 'rescuer-map-pin-shell',
    html: `<span style="display:grid;place-items:center;width:34px;height:34px;border:3px solid #fff;border-radius:50%;background:${color};box-shadow:0 4px 12px rgba(0,24,69,.28);color:#fff;font:700 16px/1 sans-serif">+</span>`,
    iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
  });
}

const STATUS_LABEL: Record<string, string> = {
  accepted: 'ยืนยันรับภารกิจแล้ว',
  en_route: 'กำลังเดินทาง',
  on_scene: 'ถึงจุดเกิดเหตุ',
};

export default function RescuerLocationMap({
  markers,
  height = 420,
}: {
  markers: RescuerMapMarker[];
  height?: number;
}) {
  const center: [number, number] = markers.length
    ? [markers[0].latitude, markers[0].longitude]
    : [7.0086, 100.4746];

  return (
    <div style={{ height, minHeight: 280, overflow: 'hidden', borderRadius: 16, border: '1px solid #DDE3EC', background: '#EEF4FA' }}>
      <MapContainer center={center} zoom={markers.length === 1 ? 13 : 10} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
        <Recenter center={center} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markers.map((marker) => (
          <Marker key={marker.id} position={[marker.latitude, marker.longitude]} icon={markerIcon(marker)}>
            <Popup>
              <div style={{ minWidth: 180, fontFamily: 'system-ui, sans-serif' }}>
                <strong>{marker.label}</strong>
                {marker.detail && <div style={{ marginTop: 3, color: '#475569', fontSize: 12 }}>{marker.detail}</div>}
                {marker.assignmentStatus && <div style={{ marginTop: 6, color: '#0353A4', fontSize: 12 }}>{STATUS_LABEL[marker.assignmentStatus] ?? marker.assignmentStatus}</div>}
                {marker.updatedAt && <div style={{ marginTop: 6, color: '#64748B', fontSize: 11 }}>อัปเดต {new Date(marker.updatedAt).toLocaleTimeString('th-TH')}</div>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
