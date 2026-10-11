import React, { useState, useEffect, useMemo, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Journey, JourneyState } from '../../domain/types/journey.ts';
import { googleMapsService } from '../../maps/google-maps-service.ts';
import { TwoLegRouteInfo, Coordinate } from '../../maps/types.ts';
import { MapPolyline } from '../maps/MapPolyline.tsx';

declare const google: any;
import {
  MapPin,
  HeartHandshake,
  Car,
  Home,
  Clock,
  Compass,
  CheckCircle2,
  Navigation,
  ExternalLink,
  ChevronRight,
  Maximize2,
  Minimize2,
  Layers,
  Sparkles,
} from 'lucide-react';

interface JourneyMiniRouteMapProps {
  journey: Journey;
  onOpenLiveTracker?: (journey: Journey) => void;
  className?: string;
  defaultHeight?: number;
}

/**
 * BoundsFitter auto-fits the Google Map viewport to encompass Pickup, Destination, and Return points
 */
function BoundsFitter({
  points,
}: {
  points: { lat: number; lng: number }[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || points.length === 0) return;
    try {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => {
        if (typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)) {
          bounds.extend({ lat: p.lat, lng: p.lng });
        }
      });
      // Pad bounds slightly for visual comfort
      map.fitBounds(bounds, { top: 35, right: 35, bottom: 35, left: 35 });
    } catch {
      // Graceful fallback
    }
  }, [map, points]);

  return null;
}

export const JourneyMiniRouteMap: React.FC<JourneyMiniRouteMapProps> = ({
  journey,
  onOpenLiveTracker,
  className = '',
  defaultHeight = 260,
}) => {
  const [routeInfo, setRouteInfo] = useState<TwoLegRouteInfo | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const apiKey = googleMapsService.apiKey;
  const isMapsConfigured = Boolean(apiKey);

  // Listen for Google Maps quota exceeded event
  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  const pickupKey = `${journey.pickupLocation?.latitude},${journey.pickupLocation?.longitude},${journey.pickupLocation?.address}`;
  const hospitalKey = `${journey.hospitalDestination?.id},${journey.hospitalDestination?.latitude},${journey.hospitalDestination?.longitude}`;
  const returnKey = `${journey.returnDropoffLocation?.latitude},${journey.returnDropoffLocation?.longitude},${journey.returnDropoffLocation?.address}`;

  // Fetch or calculate two-leg route for this journey
  useEffect(() => {
    let mounted = true;
    async function fetchRoute() {
      if (!journey.pickupLocation || !journey.hospitalDestination) return;
      try {
        const returnLoc = journey.returnDropoffLocation || journey.pickupLocation;
        const info = await googleMapsService.computeTwoLegJourneyRoute(
          journey.pickupLocation,
          journey.hospitalDestination,
          returnLoc
        );
        if (mounted) {
          setRouteInfo(info);
        }
      } catch (err: any) {
        if (mounted) {
          setMapError(err.message || 'Routing fallback');
        }
      }
    }
    fetchRoute();
    return () => {
      mounted = false;
    };
  }, [pickupKey, hospitalKey, returnKey, journey]);

  // Center calculation based on current journey state
  const center: Coordinate = useMemo(() => {
    const pLat = journey.pickupLocation?.latitude ?? 12.9716;
    const pLng = journey.pickupLocation?.longitude ?? 77.5946;
    const hLat = journey.hospitalDestination?.latitude ?? 12.9716;
    const hLng = journey.hospitalDestination?.longitude ?? 77.5946;

    const state = journey.currentState;
    if (
      state === 'ARRIVED_AT_HOSPITAL' ||
      state === 'HOSPITAL_VISIT' ||
      state === 'RETURN_STARTED'
    ) {
      return { lat: hLat, lng: hLng };
    }
    if (state === 'IN_TRANSIT_TO_HOME' || state === 'PATIENT_RETURNED_HOME') {
      const rLat = journey.returnDropoffLocation?.latitude ?? pLat;
      const rLng = journey.returnDropoffLocation?.longitude ?? pLng;
      return { lat: rLat, lng: rLng };
    }
    // Midpoint between pickup and hospital
    return {
      lat: (pLat + hLat) / 2,
      lng: (pLng + hLng) / 2,
    };
  }, [journey]);

  // Viewport bounding points
  const boundingPoints = useMemo(() => {
    const pts: { lat: number; lng: number }[] = [];
    if (journey.pickupLocation) {
      pts.push({ lat: journey.pickupLocation.latitude, lng: journey.pickupLocation.longitude });
    }
    if (journey.hospitalDestination) {
      pts.push({ lat: journey.hospitalDestination.latitude, lng: journey.hospitalDestination.longitude });
    }
    if (journey.returnDropoffLocation) {
      pts.push({ lat: journey.returnDropoffLocation.latitude, lng: journey.returnDropoffLocation.longitude });
    }
    if (journey.liveLocation) {
      pts.push({ lat: journey.liveLocation.latitude, lng: journey.liveLocation.longitude });
    }
    return pts;
  }, [journey]);

  // Determine active leg for visual highlighting
  const isLeg1Active =
    journey.currentState === 'PARTNER_ARRIVED' ||
    journey.currentState === 'PATIENT_PICKED_UP' ||
    journey.currentState === 'IN_TRANSIT_TO_HOSPITAL';

  const isLeg2Active =
    journey.currentState === 'RETURN_STARTED' ||
    journey.currentState === 'IN_TRANSIT_TO_HOME';

  const isAtHospital =
    journey.currentState === 'ARRIVED_AT_HOSPITAL' ||
    journey.currentState === 'HOSPITAL_VISIT';

  const isActive =
    journey.currentState !== 'COMPLETED' &&
    journey.currentState !== 'CANCELLED' &&
    journey.currentState !== 'PARTNER_CANCELLED';

  const heightStyle = isExpanded ? 'h-[440px]' : `h-[${defaultHeight}px]`;

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs transition-all ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Mini Map Top Bar */}
      <div className="p-3 sm:px-4 bg-slate-50/90 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
            <Compass className="w-3.5 h-3.5 text-teal-700" />
          </div>
          <div>
            <span className="font-bold text-slate-900 block leading-tight">
              Route Preview
            </span>
            <span className="text-[10px] text-slate-500 block">
              {journey.pickupLocation?.address ? journey.pickupLocation.address.split(',')[0] : 'Home'} →{' '}
              {journey.hospitalDestination?.name || 'Hospital'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {routeInfo && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-2xs">
              <span className="text-slate-600">{routeInfo.totalDistanceText}</span>
              <span className="text-slate-300">•</span>
              <span className="text-teal-700 font-semibold">{routeInfo.totalDurationText}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse map' : 'Expand map view'}
            className="p-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {onOpenLiveTracker && isActive && (
            <button
              type="button"
              onClick={() => onOpenLiveTracker(journey)}
              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg text-[11px] flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
            >
              <span>Live View</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Map Content / Interactive GMP Map */}
      <div className={`relative w-full ${isExpanded ? 'h-[440px]' : 'h-[260px]'}`}>
        {!isMapsConfigured || mapError || quotaExceeded ? (
          /* High-Fidelity SVG Fallback Visualization if Key or Network is Unreachable */
          <div className="w-full h-full bg-slate-50 p-4 flex flex-col justify-between">
            <div className="text-[11px] text-slate-600 bg-amber-50/80 border border-amber-200/80 p-2.5 rounded-xl flex items-start gap-2">
              <MapPin className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800 block">
                  Authoritative Route Geometry
                </span>
                <span className="text-slate-600 text-[10px]">
                  {quotaExceeded
                    ? 'Map quota limit reached. Using verified domain routing estimates.'
                    : !isMapsConfigured
                    ? 'Previewing planned trajectory with verified hospital coordinates.'
                    : 'Map preview fallback active.'}
                </span>
              </div>
            </div>

            {/* Schematic Route Track */}
            <div className="relative py-4 px-3 bg-white rounded-xl border border-slate-200/90 my-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800 mb-2">
                <span className="flex items-center gap-1 text-emerald-700">
                  <Home className="w-3.5 h-3.5 text-emerald-600" />
                  Pickup Point
                </span>
                <span className="flex items-center gap-1 text-rose-700">
                  <MapPin className="w-3.5 h-3.5 text-rose-600" />
                  Hospital
                </span>
                <span className="flex items-center gap-1 text-indigo-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                  Return Dropoff
                </span>
              </div>

              {/* Progress Line */}
              <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden my-3">
                <div
                  className="h-full bg-linear-to-r from-emerald-500 via-teal-500 to-indigo-500 rounded-full"
                  style={{
                    width:
                      journey.currentState === 'COMPLETED'
                        ? '100%'
                        : isLeg2Active
                        ? '80%'
                        : isAtHospital
                        ? '50%'
                        : isLeg1Active
                        ? '30%'
                        : '15%',
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>{journey.pickupLocation?.address || 'Pickup'}</span>
                <span>{journey.hospitalDestination?.name || 'Hospital'}</span>
                <span>{journey.returnDropoffLocation?.address || 'Home'}</span>
              </div>
            </div>

            {routeInfo && (
              <div className="flex items-center justify-between text-[11px] text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200 font-mono">
                <span>Leg 1: {routeInfo.leg1Outbound.distanceText} (~{routeInfo.leg1Outbound.durationText})</span>
                <span>Leg 2: {routeInfo.leg2Return.distanceText} (~{routeInfo.leg2Return.durationText})</span>
              </div>
            )}
          </div>
        ) : (
          /* Live Interactive Google Maps View */
          <APIProvider apiKey={apiKey} libraries={['places', 'routes', 'geometry']}>
            <Map
              mapId="DEMO_MAP_ID"
              defaultCenter={center}
              defaultZoom={13}
              gestureHandling="cooperative"
              disableDefaultUI={false}
              fullscreenControl={false}
              streetViewControl={false}
              mapTypeControl={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              className="w-full h-full"
            >
              {/* Dynamic Auto-Fit Bounds */}
              <BoundsFitter points={boundingPoints} />

              {/* Pickup / Home Marker */}
              {journey.pickupLocation && (
                <AdvancedMarker
                  position={{
                    lat: journey.pickupLocation.latitude,
                    lng: journey.pickupLocation.longitude,
                  }}
                  title={`Pickup: ${journey.pickupLocation.address}`}
                >
                  <div className="flex items-center justify-center p-1.5 bg-emerald-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-emerald-300">
                    <Home className="w-3.5 h-3.5" />
                  </div>
                </AdvancedMarker>
              )}

              {/* Hospital Destination Marker */}
              {journey.hospitalDestination && (
                <AdvancedMarker
                  position={{
                    lat: journey.hospitalDestination.latitude,
                    lng: journey.hospitalDestination.longitude,
                  }}
                  title={`Hospital: ${journey.hospitalDestination.name}`}
                >
                  <div className="flex items-center justify-center p-1.5 bg-rose-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-rose-300">
                    <MapPin className="w-3.5 h-3.5" />
                  </div>
                </AdvancedMarker>
              )}

              {/* Return Drop-Off Marker if Different from Pickup */}
              {journey.returnDropoffLocation &&
                (Math.abs(journey.returnDropoffLocation.latitude - (journey.pickupLocation?.latitude ?? 0)) > 0.0001 ||
                  Math.abs(journey.returnDropoffLocation.longitude - (journey.pickupLocation?.longitude ?? 0)) > 0.0001) && (
                  <AdvancedMarker
                    position={{
                      lat: journey.returnDropoffLocation.latitude,
                      lng: journey.returnDropoffLocation.longitude,
                    }}
                    title={`Return: ${journey.returnDropoffLocation.address}`}
                  >
                    <div className="flex items-center justify-center p-1.5 bg-indigo-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-indigo-300">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  </AdvancedMarker>
                )}

              {/* Companion Live Marker */}
              {journey.carePartnerId && (
                <AdvancedMarker
                  position={{
                    lat: journey.liveLocation
                      ? journey.liveLocation.latitude
                      : isAtHospital
                      ? journey.hospitalDestination.latitude
                      : isLeg2Active
                      ? (journey.hospitalDestination.latitude + (journey.returnDropoffLocation?.latitude ?? journey.pickupLocation.latitude)) / 2
                      : isLeg1Active
                      ? (journey.pickupLocation.latitude + journey.hospitalDestination.latitude) / 2
                      : journey.pickupLocation.latitude,
                    lng: journey.liveLocation
                      ? journey.liveLocation.longitude
                      : isAtHospital
                      ? journey.hospitalDestination.longitude
                      : isLeg2Active
                      ? (journey.hospitalDestination.longitude + (journey.returnDropoffLocation?.longitude ?? journey.pickupLocation.longitude)) / 2
                      : isLeg1Active
                      ? (journey.pickupLocation.longitude + journey.hospitalDestination.longitude) / 2
                      : journey.pickupLocation.longitude,
                  }}
                  title={
                    journey.liveLocation
                      ? `Companion Location (${journey.liveLocation.isStale ? 'Signal Stale' : 'Live'})`
                      : 'Companion Position'
                  }
                >
                  <div
                    className={`flex items-center justify-center p-1.5 rounded-full shadow-md border-2 border-white ring-2 ${
                      journey.liveLocation?.isStale
                        ? 'bg-amber-600 text-white ring-amber-300'
                        : journey.liveLocation
                        ? 'bg-teal-600 text-white ring-teal-300'
                        : 'bg-indigo-600 text-white ring-indigo-200'
                    }`}
                  >
                    <Car className="w-3.5 h-3.5" />
                  </div>
                </AdvancedMarker>
              )}

              {/* Outbound Leg Polyline */}
              {routeInfo?.leg1Outbound?.polylinePoints && (
                <MapPolyline
                  path={routeInfo.leg1Outbound.polylinePoints}
                  strokeColor="#0d9488"
                  strokeWeight={isLeg1Active ? 5 : 3}
                  isActive={isLeg1Active}
                />
              )}

              {/* Return Leg Polyline */}
              {routeInfo?.leg2Return?.polylinePoints && (
                <MapPolyline
                  path={routeInfo.leg2Return.polylinePoints}
                  strokeColor="#4f46e5"
                  strokeWeight={isLeg2Active ? 5 : 3}
                  isActive={isLeg2Active}
                />
              )}
            </Map>
          </APIProvider>
        )}
      </div>

      {/* Mini Route Leg Footer Strip */}
      <div className="p-3 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block"></span>
            <span className="text-[11px] font-medium">Leg 1: Outbound to Clinic</span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block"></span>
            <span className="text-[11px] font-medium">Leg 2: Return Journey Home</span>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 font-mono">
          {journey.currentState.replace(/_/g, ' ')}
        </div>
      </div>
    </div>
  );
};
