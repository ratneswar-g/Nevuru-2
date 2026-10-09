import React, { useState, useEffect } from 'react';
import { Journey, CarePartnerProfile } from '../../domain/types/index.ts';
import { neravuApi } from '../../services/api-client.ts';
import {
  HeartHandshake,
  Calendar,
  Clock,
  MapPin,
  ShieldCheck,
  ChevronRight,
  Car,
  Star,
  CheckCircle2,
  Navigation,
  FileText,
  AlertCircle,
  ExternalLink,
  History,
  Activity,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

interface PatientDashboardProps {
  journeys: Journey[];
  activeJourney: Journey | null;
  onSelectJourney?: (journey: Journey) => void;
  onRequestBooking?: () => void;
}

export const PatientDashboard: React.FC<PatientDashboardProps> = ({
  journeys,
  activeJourney,
  onSelectJourney,
  onRequestBooking,
}) => {
  const [partnerProfiles, setPartnerProfiles] = useState<Record<string, CarePartnerProfile>>({});
  const [selectedJourneyDetail, setSelectedJourneyDetail] = useState<Journey | null>(null);
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'PAST'>('ALL');

  // Load Care Partner profiles for all relevant journeys
  useEffect(() => {
    const partnerIds = Array.from(
      new Set(
        journeys
          .map((j) => j.carePartnerId)
          .filter((id): id is string => Boolean(id))
      )
    );

    partnerIds.forEach(async (id) => {
      if (!partnerProfiles[id]) {
        try {
          const profile = await neravuApi.getCarePartnerProfile(id);
          if (profile) {
            setPartnerProfiles((prev) => ({ ...prev, [id]: profile }));
          }
        } catch {
          // Graceful fallback for non-existent profiles
        }
      }
    });
  }, [journeys]);

  const pastJourneys = journeys.filter(
    (j) => j.currentState === 'COMPLETED' || j.currentState === 'CANCELLED' || j.currentState === 'PARTNER_CANCELLED'
  );

  const activeJourneys = journeys.filter(
    (j) => j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED' && j.currentState !== 'PARTNER_CANCELLED'
  );

  const displayedJourneys =
    filterTab === 'ACTIVE'
      ? activeJourneys
      : filterTab === 'PAST'
      ? pastJourneys
      : journeys;

  const getStatusBadge = (state: string) => {
    switch (state) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'CANCELLED':
      case 'PARTNER_CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            Cancelled
          </span>
        );
      case 'EMERGENCY_ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300 animate-pulse">
            <AlertCircle className="w-3.5 h-3.5" />
            Emergency Active
          </span>
        );
      case 'HOSPITAL_VISIT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <HeartHandshake className="w-3.5 h-3.5" />
            Accompanied in Hospital
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
            <Activity className="w-3.5 h-3.5 animate-spin-slow" />
            {state.replace(/_/g, ' ')}
          </span>
        );
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Recent';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Dashboard Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Total Medical Journeys
            </span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">
              {journeys.length}
            </span>
          </div>
          <div className="p-3 bg-teal-50 text-teal-600 rounded-xl">
            <History className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Active Journeys
            </span>
            <span className="text-2xl font-black text-teal-700 mt-1 block">
              {activeJourneys.length}
            </span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Completed Visits
            </span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">
              {pastJourneys.filter((j) => j.currentState === 'COMPLETED').length}
            </span>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Primary Active Journey Highlight Card */}
      {activeJourney && (
        <div className="bg-linear-to-r from-teal-900 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-teal-300">
                  Active Medical Journey in Progress
                </span>
              </div>
              <h2 className="text-xl font-bold text-white">
                {activeJourney.hospitalDestination.name}
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                {activeJourney.hospitalDestination.address}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-teal-500/20 text-teal-200 border border-teal-400/30 rounded-full text-xs font-mono font-bold">
                {activeJourney.currentState.replace(/_/g, ' ')}
              </span>
              {onSelectJourney && (
                <button
                  type="button"
                  onClick={() => onSelectJourney(activeJourney)}
                  className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Open Live Tracker</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-1 text-xs">
            {/* Route & Times */}
            <div className="space-y-2 bg-white/5 p-3.5 rounded-xl border border-white/10">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                    Pickup Location (Home)
                  </span>
                  <span className="font-medium text-slate-200">
                    {activeJourney.pickupLocation.address}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2 pt-2 border-t border-white/10">
                <Clock className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                    Requested At
                  </span>
                  <span className="font-medium text-slate-200">
                    {formatDate(activeJourney.createdAt)} ({activeJourney.bookingType})
                  </span>
                </div>
              </div>
            </div>

            {/* Assigned Care Partner Details */}
            <div className="space-y-2 bg-white/5 p-3.5 rounded-xl border border-white/10">
              {activeJourney.carePartnerId ? (
                (() => {
                  const partner = partnerProfiles[activeJourney.carePartnerId];
                  return (
                    <div>
                      <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">
                          Assigned Care Partner
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                          <ShieldCheck className="w-3 h-3" />
                          Verified Companion
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="p-2 bg-teal-500/20 text-teal-300 rounded-lg">
                          <HeartHandshake className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-bold text-white text-sm block">
                            Assigned Companion
                          </span>
                          {partner?.vehicle ? (
                            <span className="text-slate-300 text-[11px] block mt-0.5">
                              {partner.vehicle.make} {partner.vehicle.model} •{' '}
                              <span className="font-mono text-teal-300">
                                {partner.vehicle.licensePlate}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-300 text-[11px] block mt-0.5">
                              Vehicle details assigned
                            </span>
                          )}
                          <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
                            {partner && typeof partner.totalJourneysCompleted === 'number' && (
                              <span>{partner.totalJourneysCompleted}+ Journeys</span>
                            )}
                            {partner && typeof partner.ratingAverage === 'number' && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-0.5 text-amber-300">
                                  <Star className="w-3 h-3 fill-amber-300" />
                                  {partner.ratingAverage.toFixed(1)} Rating
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex items-center gap-3 h-full">
                  <div className="p-2.5 bg-amber-500/20 text-amber-300 rounded-xl">
                    <Activity className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">
                      Matching Nearest Care Partner
                    </span>
                    <span className="text-[11px] text-slate-300">
                      Our platform is pairing you with a verified medical companion nearby.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Journeys List Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-teal-600" />
              Medical Journey History & Active Status
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Review current and previous hospital round-trips with companion details and milestone updates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setFilterTab('ALL')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filterTab === 'ALL'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({journeys.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('ACTIVE')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filterTab === 'ACTIVE'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({activeJourneys.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('PAST')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filterTab === 'PAST'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Past ({pastJourneys.length})
              </button>
            </div>

            {onRequestBooking && !activeJourney && (
              <button
                type="button"
                onClick={onRequestBooking}
                className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                New Booking
              </button>
            )}
          </div>
        </div>

        {displayedJourneys.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="inline-flex p-3 bg-slate-100 text-slate-400 rounded-2xl">
              <Calendar className="w-8 h-8" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">
              {filterTab === 'ACTIVE'
                ? 'No active journeys right now'
                : filterTab === 'PAST'
                ? 'No past journeys recorded yet'
                : 'No medical journeys booked yet'}
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              When you book a Care Partner for clinic visits or procedures, round-trip updates and companion details appear here.
            </p>
            {onRequestBooking && !activeJourney && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onRequestBooking}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Book Your First Round-Trip Journey
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayedJourneys.map((journey) => {
              const partner = journey.carePartnerId ? partnerProfiles[journey.carePartnerId] : null;
              const isSelected = selectedJourneyDetail?.id === journey.id;
              const isActive =
                journey.currentState !== 'COMPLETED' &&
                journey.currentState !== 'CANCELLED' &&
                journey.currentState !== 'PARTNER_CANCELLED';

              return (
                <div
                  key={journey.id}
                  className={`rounded-2xl border transition-all ${
                    isActive
                      ? 'border-teal-300 bg-teal-50/20 ring-1 ring-teal-200'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {getStatusBadge(journey.currentState)}
                        <span className="text-[11px] font-mono text-slate-400">
                          {journey.id.slice(0, 18)}...
                        </span>
                        <span className="text-[11px] text-slate-400">•</span>
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formatDate(journey.createdAt)}
                        </span>
                        <span className="text-[11px] px-2 py-0.2 rounded bg-slate-100 text-slate-600 font-mono">
                          {journey.bookingType}
                        </span>
                      </div>

                      <div className="pt-1">
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-teal-600 shrink-0" />
                          <span>{journey.hospitalDestination.name}</span>
                        </h4>
                        <p className="text-xs text-slate-500 pl-5.5 mt-0.5">
                          From: {journey.pickupLocation.address}
                        </p>
                      </div>

                      {/* Care Partner Snapshot */}
                      <div className="pl-5.5 pt-1.5 flex flex-wrap items-center gap-4 text-xs">
                        {journey.carePartnerId ? (
                          <div className="flex items-center gap-2 text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                            <HeartHandshake className="w-3.5 h-3.5 text-indigo-600" />
                            <span className="font-semibold text-slate-900">
                              Care Partner Assigned
                            </span>
                            {partner?.vehicle && (
                              <span className="text-slate-500 font-mono text-[11px]">
                                ({partner.vehicle.make} • {partner.vehicle.licensePlate})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">
                            {journey.currentState === 'MATCHING'
                              ? 'Finding verified companion...'
                              : 'No Care Partner assigned'}
                          </span>
                        )}

                        {journey.fareEstimate?.total && (
                          <span className="text-slate-600 font-mono text-xs">
                            Fare: ₹{journey.fareEstimate.total}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end md:self-center">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedJourneyDetail(isSelected ? null : journey)
                        }
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                      >
                        {isSelected ? 'Hide Details' : 'View Details & Care Partner'}
                      </button>

                      {isActive && onSelectJourney && (
                        <button
                          type="button"
                          onClick={() => onSelectJourney(journey)}
                          className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span>Live View</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Journey Details */}
                  {isSelected && (
                    <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 rounded-b-2xl space-y-4 text-xs">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Care Partner Detailed Card */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                              Assigned Care Partner Profile
                            </span>
                            {partner?.verificationStatus === 'VERIFIED' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                <ShieldCheck className="w-3 h-3" />
                                Verified Companion
                              </span>
                            )}
                          </div>

                          {journey.carePartnerId ? (
                            <div className="space-y-2">
                              <div className="flex items-start gap-3">
                                <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
                                  <HeartHandshake className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                  <span className="font-bold text-slate-900 text-sm block">
                                    Assigned Medical Companion
                                  </span>
                                  <span className="text-slate-500 text-[11px] block mt-0.5">
                                    Non-Clinical Patient Care Partner (Door-to-Door & Hospital Accompaniment)
                                  </span>
                                  <div className="flex items-center gap-3 text-[11px] text-slate-600 mt-2">
                                    <span className="flex items-center gap-1 text-amber-500 font-semibold">
                                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                                      {partner?.ratingAverage ?? 5.0} Rating
                                    </span>
                                    <span>•</span>
                                    <span>
                                      {partner?.totalJourneysCompleted ?? 10} Journeys Completed
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {partner?.vehicle && (
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                                  <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                                    <Car className="w-3.5 h-3.5 text-teal-600" />
                                    <span>Vehicle Information</span>
                                  </div>
                                  <div className="flex justify-between text-slate-600 text-[11px] pt-1">
                                    <span>Model:</span>
                                    <span className="font-medium text-slate-900">
                                      {partner.vehicle.make} {partner.vehicle.model}
                                    </span>
                                  </div>
                                  <div className="flex justify-between text-slate-600 text-[11px]">
                                    <span>Registration Number:</span>
                                    <span className="font-mono font-bold text-slate-900">
                                      {partner.vehicle.licensePlate}
                                    </span>
                                  </div>
                                  {partner.vehicle.isWheelchairAccessible && (
                                    <div className="pt-1 text-[10px] text-teal-700 font-medium">
                                      ✓ Assisted Wheelchair Accessible Vehicle
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3 text-slate-500 italic text-center">
                              No Care Partner assigned to this journey record.
                            </div>
                          )}
                        </div>

                        {/* Journey Milestones / Status Updates */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                              Milestone History & Status Updates
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {journey.stateHistory?.length || 1} Events
                            </span>
                          </div>

                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {journey.stateHistory && journey.stateHistory.length > 0 ? (
                              journey.stateHistory.map((step, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-2.5 pb-2 border-b border-slate-100 last:border-0"
                                >
                                  <div className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />
                                  <div className="flex-1 text-[11px]">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-slate-900">
                                        {step.toState.replace(/_/g, ' ')}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {formatDate(step.timestamp)}
                                      </span>
                                    </div>
                                    {step.note && (
                                      <p className="text-slate-600 mt-0.5 leading-snug">
                                        {step.note}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-slate-500 text-[11px]">
                                Initial state: {journey.currentState.replace(/_/g, ' ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Route Details & Notes */}
                      <div className="bg-white p-4 rounded-xl border border-slate-200 text-[11px] grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <span className="text-[10px] uppercase text-slate-400 font-bold block">
                            Pickup Address (Home)
                          </span>
                          <span className="font-medium text-slate-800 block mt-0.5">
                            {journey.pickupLocation.address}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase text-slate-400 font-bold block">
                            Hospital Destination
                          </span>
                          <span className="font-medium text-slate-800 block mt-0.5">
                            {journey.hospitalDestination.name}
                          </span>
                          <span className="text-slate-500 block text-[10px]">
                            {journey.hospitalDestination.address}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase text-slate-400 font-bold block">
                            Return Drop-off
                          </span>
                          <span className="font-medium text-slate-800 block mt-0.5">
                            {journey.returnDropoffLocation?.address || journey.pickupLocation.address}
                          </span>
                        </div>
                        {journey.specialAssistanceNotes && (
                          <div className="sm:col-span-3 pt-2 border-t border-slate-100">
                            <span className="text-[10px] uppercase text-slate-400 font-bold block">
                              Assistance & Mobility Notes
                            </span>
                            <span className="text-slate-700 block mt-0.5">
                              {journey.specialAssistanceNotes}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
