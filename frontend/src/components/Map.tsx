import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Navigation,
  MapPin,
  Ambulance,
  Compass,
  Play,
  Pause,
  FastForward,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  Radio
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { api } from '../lib/api.js';

interface IncomingAmbulance {
  id: string;
  plate: string;
  lat: number;
  lng: number;
  speed?: number;
  etaMinutes?: number;
  isStale?: boolean;
  requestId?: string;
  isConfirmed?: boolean;
}

interface MapProps {
  className?: string;
  hospitalLocation?: { lat: number; lng: number; name?: string };
  incomingAmbulances?: IncomingAmbulance[];
  onAmbulanceArrived?: (requestId: string) => void;
}

// Distance helper
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function MapView({
  className,
  hospitalLocation = { lat: 13.063182, lng: 80.251538, name: 'Apollo Hospitals Greams Road' },
  incomingAmbulances = [],
  onAmbulanceArrived
}: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const hospitalMarkerRef = useRef<L.Marker | null>(null);
  const ambulanceMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routePolylinesRef = useRef<Map<string, L.Polyline>>(new Map());

  // Simulation State
  const [isAutoDrive, setIsAutoDrive] = useState(true);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(1);
  const [hasArrivedAtBay, setHasArrivedAtBay] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);

  // Animated ambulance coordinates tracking (requestId -> current lat/lng)
  const activeAmbulance = incomingAmbulances[0] || null;
  const isConfirmed = activeAmbulance?.isConfirmed ?? false;

  const [ambPosition, setAmbPosition] = useState<{ lat: number; lng: number }>({
    lat: activeAmbulance?.lat || hospitalLocation.lat + 0.015,
    lng: activeAmbulance?.lng || hospitalLocation.lng + 0.018
  });

  // Track initial origin position
  const initialOriginRef = useRef<{ lat: number; lng: number }>({
    lat: activeAmbulance?.lat || hospitalLocation.lat + 0.015,
    lng: activeAmbulance?.lng || hospitalLocation.lng + 0.018
  });

  // Calculate live dynamic distance & ETA
  const liveDistanceKm = getDistanceKm(
    ambPosition.lat,
    ambPosition.lng,
    hospitalLocation.lat,
    hospitalLocation.lng
  );
  const liveEtaMinutes = Math.max(1, Math.round((liveDistanceKm / 40) * 60));

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [hospitalLocation.lat, hospitalLocation.lng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false
      });

      // Add CartoDB Voyager / OpenStreetMap clean tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(map);

      // Add standard zoom control on bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Sync Hospital Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (hospitalMarkerRef.current) {
      hospitalMarkerRef.current.remove();
    }

    const hospIcon = L.divIcon({
      className: 'custom-hosp-marker',
      html: `
        <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer">
          <span class="animate-ping absolute inline-flex h-9 w-9 rounded-full bg-emerald-500 opacity-50"></span>
          <div class="relative flex items-center justify-center w-8 h-8 rounded-2xl bg-emerald-600 text-white shadow-xl shadow-emerald-600/40 border-2 border-white font-black text-xs">
            H
          </div>
          <div class="absolute top-9 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shadow-lg border border-slate-700">
            ${hospitalLocation.name || 'Hospital ER'}
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([hospitalLocation.lat, hospitalLocation.lng], {
      icon: hospIcon,
      zIndexOffset: 100
    }).addTo(map);

    hospitalMarkerRef.current = marker;
  }, [hospitalLocation]);

  // Sync Origin when active ambulance changes
  useEffect(() => {
    if (activeAmbulance?.lat && activeAmbulance?.lng) {
      initialOriginRef.current = { lat: activeAmbulance.lat, lng: activeAmbulance.lng };
      // Only reset position if far from current
      if (getDistanceKm(ambPosition.lat, ambPosition.lng, activeAmbulance.lat, activeAmbulance.lng) > 0.05) {
        setAmbPosition({ lat: activeAmbulance.lat, lng: activeAmbulance.lng });
        setCurrentProgress(0);
        setHasArrivedAtBay(false);
      }
    }
  }, [activeAmbulance?.id]);

  // Ambulance Marker & Dynamic Glowing Route Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing ambulance marker & polyline
    const ambId = activeAmbulance?.id || 'AMB_MAIN';
    if (ambulanceMarkersRef.current.has(ambId)) {
      ambulanceMarkersRef.current.get(ambId)?.remove();
      ambulanceMarkersRef.current.delete(ambId);
    }
    if (routePolylinesRef.current.has(ambId)) {
      routePolylinesRef.current.get(ambId)?.remove();
      routePolylinesRef.current.delete(ambId);
    }

    const isArrived = liveDistanceKm < 0.06;

    // Custom DivIcon for Ambulance with dynamic heading and siren ping
    const ambIcon = L.divIcon({
      className: 'custom-ambulance-marker',
      html: `
        <div class="relative flex flex-col items-center -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform duration-500">
          <span class="animate-ping absolute inline-flex h-10 w-10 rounded-full ${isArrived ? 'bg-emerald-500' : 'bg-rose-500'} opacity-60"></span>
          <div class="relative p-2 rounded-2xl ${isArrived ? 'bg-emerald-600' : 'bg-zinc-950'} text-white shadow-2xl border-2 ${isArrived ? 'border-emerald-300 shadow-emerald-500/50' : 'border-[#FF8DA1] shadow-rose-900/40'} flex items-center justify-center">
            <svg class="w-4 h-4 ${isArrived ? 'text-white' : 'text-[#FF8DA1]'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div class="mt-1 px-2 py-0.5 rounded-lg bg-zinc-950/90 text-white border border-slate-700 shadow-lg text-[9px] font-mono font-bold whitespace-nowrap flex items-center gap-1">
            <span>${activeAmbulance?.plate || 'TN-09-EM-104'}</span>
            <span class="${isArrived ? 'text-emerald-400 font-extrabold' : 'text-amber-400'}">
              ${isArrived ? 'AT BAY' : `${liveEtaMinutes}m`}
            </span>
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const ambMarker = L.marker([ambPosition.lat, ambPosition.lng], {
      icon: ambIcon,
      zIndexOffset: 500
    }).addTo(map);

    ambulanceMarkersRef.current.set(ambId, ambMarker);

    // Draw glowing polyline connecting ambulance to hospital
    const polyline = L.polyline(
      [
        [ambPosition.lat, ambPosition.lng],
        [hospitalLocation.lat, hospitalLocation.lng]
      ],
      {
        color: isConfirmed ? '#f43f5e' : '#6366f1',
        weight: 4,
        opacity: 0.85,
        dashArray: isConfirmed ? '8, 8' : undefined,
        lineCap: 'round',
        lineJoin: 'round'
      }
    ).addTo(map);

    routePolylinesRef.current.set(ambId, polyline);

    // Fit bounds smoothly on initial placement
    const bounds = L.latLngBounds([
      [hospitalLocation.lat, hospitalLocation.lng],
      [ambPosition.lat, ambPosition.lng]
    ]);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }, [ambPosition, hospitalLocation, liveDistanceKm, liveEtaMinutes, isConfirmed]);

  // Step ambulance forward towards hospital
  const stepForward = useCallback(
    (stepPercent = 0.12) => {
      const targetLat = hospitalLocation.lat;
      const targetLng = hospitalLocation.lng;

      setAmbPosition((prev) => {
        const deltaLat = targetLat - prev.lat;
        const deltaLng = targetLng - prev.lng;
        const remainingDist = getDistanceKm(prev.lat, prev.lng, targetLat, targetLng);

        // If very close, snap to hospital
        if (remainingDist < 0.08 || currentProgress >= 95) {
          setHasArrivedAtBay(true);
          setCurrentProgress(100);
          if (activeAmbulance?.requestId && onAmbulanceArrived) {
            onAmbulanceArrived(activeAmbulance.requestId);
          }
          return { lat: targetLat, lng: targetLng };
        }

        const nextLat = prev.lat + deltaLat * stepPercent;
        const nextLng = prev.lng + deltaLng * stepPercent;

        setCurrentProgress((p) => Math.min(99, Math.round(p + stepPercent * 100)));

        // Send telemetry ping in background
        if (activeAmbulance?.id) {
          api
            .simulateGps({
              ambulanceId: activeAmbulance.id,
              requestId: activeAmbulance.requestId,
              lat: nextLat,
              lng: nextLng,
              speed: 48
            })
            .catch(() => {});
        }

        return { lat: nextLat, lng: nextLng };
      });
    },
    [hospitalLocation, currentProgress, activeAmbulance, onAmbulanceArrived]
  );

  // Instant Bay Arrival
  const handleInstantArrive = () => {
    setAmbPosition({ lat: hospitalLocation.lat, lng: hospitalLocation.lng });
    setCurrentProgress(100);
    setHasArrivedAtBay(true);
    if (activeAmbulance?.requestId && onAmbulanceArrived) {
      onAmbulanceArrived(activeAmbulance.requestId);
    }
    if (activeAmbulance?.id) {
      api
        .simulateGps({
          ambulanceId: activeAmbulance.id,
          requestId: activeAmbulance.requestId,
          lat: hospitalLocation.lat,
          lng: hospitalLocation.lng,
          speed: 0
        })
        .catch(() => {});
    }
  };

  // Reset Ambulance to starting point
  const handleResetRoute = () => {
    const origin = initialOriginRef.current;
    setAmbPosition({ lat: origin.lat, lng: origin.lng });
    setCurrentProgress(0);
    setHasArrivedAtBay(false);
  };

  // Continuous forward movement ticker when reservation is confirmed
  useEffect(() => {
    if (!isAutoDrive || !isConfirmed || hasArrivedAtBay) return;

    const intervalMs = Math.max(800, 2000 / simulationSpeed);
    const timer = setInterval(() => {
      stepForward(0.08 * simulationSpeed);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isAutoDrive, isConfirmed, hasArrivedAtBay, simulationSpeed, stepForward]);

  return (
    <div
      className={cn(
        'relative w-full h-[400px] rounded-3xl overflow-hidden border border-slate-200/90 shadow-sm bg-slate-900',
        className
      )}
    >
      {/* Leaflet Map Div */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top Left: Live Status Badge */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-slate-700/80 shadow-xl">
        <div className="p-1 rounded-lg bg-rose-500/20 text-rose-400">
          <Radio className="w-4 h-4 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-xs text-white">Ambulance GPS Telemetry</span>
            {isConfirmed ? (
              <span className="text-[9px] font-mono font-extrabold uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                CONFIRMED & EN ROUTE
              </span>
            ) : (
              <span className="text-[9px] font-mono font-extrabold uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                STANDBY PROVISIONAL
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-300 flex items-center gap-2">
            <span>
              Distance: <strong className="text-white">{liveDistanceKm.toFixed(2)} km</strong>
            </span>
            <span>•</span>
            <span>
              ETA: <strong className="text-emerald-400">{liveDistanceKm < 0.08 ? 'Arrived at Bay' : `${liveEtaMinutes} mins`}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Top Right: Progress & Arrival Banner */}
      {hasArrivedAtBay ? (
        <div className="absolute top-3 right-3 z-30 bg-emerald-600 text-white px-3.5 py-2 rounded-2xl shadow-xl flex items-center gap-2 animate-bounce border border-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <div className="text-xs font-black">Ambulance At Trauma Bay! Handover Ready</div>
        </div>
      ) : (
        <div className="absolute top-3 right-3 z-30 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-700/80 shadow-xl flex items-center gap-2 text-xs text-white">
          <div className="w-20 bg-slate-700 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: `${currentProgress}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-emerald-400 font-bold">{currentProgress}%</span>
        </div>
      )}

      {/* Bottom Floating Control Bar for User Interaction */}
      <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center justify-between gap-2 bg-slate-950/85 backdrop-blur-md p-2.5 rounded-2xl border border-slate-800 shadow-2xl">
        <div className="flex items-center gap-2">
          {/* Play/Pause Auto-Drive */}
          <button
            type="button"
            onClick={() => setIsAutoDrive(!isAutoDrive)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border',
              isAutoDrive && isConfirmed
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            )}
            title="Toggle automatic GPS drive along route"
          >
            {isAutoDrive && isConfirmed ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Auto-Drive (Active)</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Start Drive</span>
              </>
            )}
          </button>

          {/* Speed Selector */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-xl border border-slate-800 text-[10px] font-mono">
            <span className="text-slate-400">Speed:</span>
            {[1, 2, 4].map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setSimulationSpeed(spd)}
                className={cn(
                  'px-1.5 py-0.5 rounded font-bold transition',
                  simulationSpeed === spd
                    ? 'bg-[#FF8DA1] text-zinc-950'
                    : 'text-slate-300 hover:bg-slate-800'
                )}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Manual Step Forward & Instant Arrive */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => stepForward(0.18)}
            disabled={hasArrivedAtBay}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-1"
            title="Step ambulance forward along road"
          >
            <FastForward className="w-3.5 h-3.5 text-rose-400" />
            <span>Forward (+20%)</span>
          </button>

          <button
            type="button"
            onClick={handleInstantArrive}
            disabled={hasArrivedAtBay}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-emerald-400 text-xs font-bold border border-emerald-500/40 shadow-xs transition flex items-center gap-1"
            title="Simulate immediate arrival at hospital entrance"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Instant Arrive</span>
          </button>

          <button
            type="button"
            onClick={handleResetRoute}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Reset ambulance to starting origin"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
