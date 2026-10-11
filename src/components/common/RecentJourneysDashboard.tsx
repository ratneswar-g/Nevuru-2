import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../auth/index.ts';
import { neravuApi } from '../../services/api-client.ts';
import { Journey, JourneyState, CarePartnerProfile } from '../../domain/types/index.ts';
import {
  Calendar,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Activity,
  HeartHandshake,
  Car,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
  Filter,
  UserCheck,
  Building2,
  Navigation2,
  Info,
  Download,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import {
  exportJourneysToCsv,
  exportJourneysToPdf,
} from '../../services/journeyExport.ts';
import {
  JourneyFilterBar,
  JourneyFilterState as TabFilter,
  filterJourneysByState,
  calculateJourneyCounts,
} from './JourneyFilterBar.tsx';
import { JourneyMiniRouteMap } from './JourneyMiniRouteMap.tsx';
import { JourneyActivityTimeline } from './JourneyActivityTimeline.tsx';

export interface RecentJourneysDashboardProps {
  /** Optional callback when user clicks a journey row/card */
  onSelectJourney?: (journey: Journey) => void;
  /** Optional callback to initiate a new medical transport booking */
  onRequestBooking?: () => void;
  /** Filter to a specific patient ID if needed (defaults to currentUser.id when role is PATIENT) */
  patientId?: string;
  /** Custom heading title */
  title?: string;
  /** Custom subtitle */
  subtitle?: string;
  /** Compact card mode suitable for widgets */
  compact?: boolean;
  /** Initial filter tab selection */
  initialFilter?: TabFilter;
}

export type { TabFilter };

export const RecentJourneysDashboard: React.FC<RecentJourneysDashboardProps> = ({
  onSelectJourney,
  onRequestBooking,
  patientId,
  title = 'Recent Journeys',
  subtitle = 'Upcoming medical visits, active transports, and completed hospital companion records',
  compact = false,
  initialFilter = 'ALL',
}) => {
  const { currentUser } = useAuth();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<TabFilter>(initialFilter);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [partnerProfiles, setPartnerProfiles] = useState<Record<string, CarePartnerProfile>>({});
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [journeySubTabs, setJourneySubTabs] = useState<Record<string, 'TIMELINE' | 'MAP'>>({});
  const [dashboardView, setDashboardView] = useState<'CARDS' | 'TIMELINE_BOARD'>('CARDS');
  const [selectedTimelineBoardJourneyId, setSelectedTimelineBoardJourneyId] = useState<string | null>(null);

  const targetPatientId = patientId || (currentUser?.role === 'PATIENT' ? currentUser.id : undefined);

  // Fetch all journeys from existing API endpoint
  const fetchJourneys = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await neravuApi.getJourneys();
      // If patientId is specified or user is PATIENT, scope to patient
      const filtered = targetPatientId
        ? data.filter((j) => j.patientId === targetPatientId)
        : data;

      // Sort with upcoming / active first, then recent descending by creation/scheduled date
      const sorted = [...filtered].sort((a, b) => {
        const timeA = new Date(a.scheduledPickupTime || a.createdAt).getTime();
        const timeB = new Date(b.scheduledPickupTime || b.createdAt).getTime();
        return timeB - timeA;
      });

      setJourneys(sorted);
      setLastRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

      // Fetch profiles for unique care partners
      const partnerIds = Array.from(
        new Set(sorted.map((j) => j.carePartnerId).filter((id): id is string => Boolean(id)))
      );

      partnerIds.forEach(async (pId) => {
        try {
          const profile = await neravuApi.getCarePartnerProfile(pId);
          if (profile) {
            setPartnerProfiles((prev) => ({ ...prev, [pId]: profile }));
          }
        } catch {
          // Graceful fallback for profile lookup
        }
      });
    } catch (err: any) {
      const msg = err?.userFriendlyMessage || err?.message || 'Failed to fetch journeys. Please check network connectivity.';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [targetPatientId]);

  useEffect(() => {
    fetchJourneys();
  }, [fetchJourneys]);

  // Categorize helper
  const isUpcoming = (j: Journey) => {
    return (
      j.bookingType === 'SCHEDULED' &&
      (j.currentState === 'DRAFT' || j.currentState === 'REQUESTED' || j.currentState === 'MATCHING')
    );
  };

  const isActiveTransport = (j: Journey) => {
    return (
      j.currentState !== 'COMPLETED' &&
      j.currentState !== 'CANCELLED' &&
      j.currentState !== 'PARTNER_CANCELLED' &&
      !isUpcoming(j)
    );
  };

  const isPastCompleted = (j: Journey) => {
    return j.currentState === 'COMPLETED';
  };

  const isCancelled = (j: Journey) => {
    return j.currentState === 'CANCELLED' || j.currentState === 'PARTNER_CANCELLED';
  };

  // Status Badge Rendering with explicit colors, icons, and labels
  const renderStatusBadge = (state: JourneyState, bookingType?: string) => {
    switch (state) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Completed</span>
          </span>
        );
      case 'CANCELLED':
      case 'PARTNER_CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span>Cancelled</span>
          </span>
        );
      case 'EMERGENCY_ACTIVE':
      case 'ESCALATED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-700 shrink-0" />
            <span>Emergency Active</span>
          </span>
        );
      case 'HOSPITAL_VISIT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <HeartHandshake className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span>At Hospital Consultation</span>
          </span>
        );
      case 'IN_TRANSIT_TO_HOSPITAL':
      case 'IN_TRANSIT_TO_HOME':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
            <Car className="w-3.5 h-3.5 text-teal-600 shrink-0 animate-bounce" />
            <span>In Transit</span>
          </span>
        );
      case 'PARTNER_EN_ROUTE':
      case 'PARTNER_ARRIVED':
      case 'PATIENT_PICKED_UP':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Activity className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-spin" />
            <span>{state.replace(/_/g, ' ')}</span>
          </span>
        );
      case 'REQUESTED':
      case 'MATCHING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>Matching Companion</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span>{state.replace(/_/g, ' ')}</span>
          </span>
        );
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Not scheduled';
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

  // Filter & Search
  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      // Tab filter
      if (filterTab === 'UPCOMING' && !isUpcoming(j)) return false;
      if (filterTab === 'ACTIVE' && !isActiveTransport(j)) return false;
      if (filterTab === 'COMPLETED' && !isPastCompleted(j)) return false;
      if (filterTab === 'CANCELLED' && !isCancelled(j)) return false;

      // Query search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hospName = j.hospitalDestination?.name?.toLowerCase() || '';
        const pickupAddr = j.pickupLocation?.address?.toLowerCase() || '';
        const idMatch = j.id.toLowerCase().includes(q);
        const stateMatch = j.currentState.toLowerCase().includes(q);
        return hospName.includes(q) || pickupAddr.includes(q) || idMatch || stateMatch;
      }
      return true;
    });
  }, [journeys, filterTab, searchQuery]);

  const counts = useMemo(() => calculateJourneyCounts(journeys), [journeys]);

  const upcomingCount = counts.upcoming || 0;
  const activeCount = counts.active || 0;
  const completedCount = counts.completed || 0;
  const cancelledCount = counts.cancelled || 0;

  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const handleExportCsv = useCallback(() => {
    try {
      if (filteredJourneys.length === 0) {
        setExportNotice('No journeys match current filter to export.');
        setTimeout(() => setExportNotice(null), 4000);
        return;
      }
      exportJourneysToCsv(filteredJourneys, {
        filterName: filterTab === 'ALL' ? 'All Trips' : filterTab,
        searchQuery,
        userName: currentUser?.name,
        userRole: currentUser?.role,
      });
      setExportNotice(`Exported ${filteredJourneys.length} journeys as CSV successfully.`);
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err: any) {
      setExportNotice(err?.message || 'Failed to export CSV.');
      setTimeout(() => setExportNotice(null), 4000);
    }
  }, [filteredJourneys, filterTab, searchQuery, currentUser]);

  const handleExportPdf = useCallback(() => {
    try {
      if (filteredJourneys.length === 0) {
        setExportNotice('No journeys match current filter to export.');
        setTimeout(() => setExportNotice(null), 4000);
        return;
      }
      exportJourneysToPdf(filteredJourneys, {
        filterName: filterTab === 'ALL' ? 'All Trips' : filterTab,
        searchQuery,
        userName: currentUser?.name,
        userRole: currentUser?.role,
      });
      setExportNotice(`Prepared printable PDF report with ${filteredJourneys.length} journeys.`);
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err: any) {
      setExportNotice(err?.message || 'Failed to prepare PDF report.');
      setTimeout(() => setExportNotice(null), 4000);
    }
  }, [filteredJourneys, filterTab, searchQuery, currentUser]);

  return (
    <div className={`space-y-5 ${compact ? '' : 'max-w-6xl mx-auto'}`}>
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-teal-50 text-teal-700 rounded-xl">
                <Navigation2 className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">{title}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            {onRequestBooking && (
              <button
                type="button"
                onClick={onRequestBooking}
                className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>Book Transport</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchJourneys(true)}
              disabled={isRefreshing || isLoading}
              title="Refresh journeys list from API"
              className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-teal-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quick KPI Stat Bar & Interactive Filter Shortcut */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setFilterTab('ALL')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              filterTab === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-slate-50/70 hover:bg-slate-100/70 text-slate-900 border-slate-100'
            }`}
          >
            <span className={`text-[11px] font-semibold uppercase tracking-wider block ${filterTab === 'ALL' ? 'text-slate-300' : 'text-slate-500'}`}>
              Total Journeys
            </span>
            <span className="text-xl font-bold mt-0.5 block">{journeys.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('UPCOMING')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              filterTab === 'UPCOMING'
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-blue-50/40 hover:bg-blue-50/80 text-blue-900 border-blue-100/70'
            }`}
          >
            <span className={`text-[11px] font-semibold uppercase tracking-wider block ${filterTab === 'UPCOMING' ? 'text-blue-100' : 'text-blue-700'}`}>
              Upcoming Trips
            </span>
            <span className="text-xl font-bold mt-0.5 block">{upcomingCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('COMPLETED')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              filterTab === 'COMPLETED'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-emerald-50/40 hover:bg-emerald-50/80 text-emerald-900 border-emerald-100/70'
            }`}
          >
            <span className={`text-[11px] font-semibold uppercase tracking-wider block ${filterTab === 'COMPLETED' ? 'text-emerald-100' : 'text-emerald-700'}`}>
              Completed Trips
            </span>
            <span className="text-xl font-bold mt-0.5 block">{completedCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('CANCELLED')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              filterTab === 'CANCELLED'
                ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                : 'bg-slate-100/60 hover:bg-slate-200/60 text-slate-800 border-slate-200/70'
            }`}
          >
            <span className={`text-[11px] font-semibold uppercase tracking-wider block ${filterTab === 'CANCELLED' ? 'text-slate-300' : 'text-slate-600'}`}>
              Cancelled Trips
            </span>
            <span className="text-xl font-bold mt-0.5 block">{cancelledCount}</span>
          </button>
        </div>
      </div>

      {/* Reusable JourneyFilterBar Component with CSV & PDF Export */}
      <JourneyFilterBar
        selectedFilter={filterTab}
        onFilterChange={setFilterTab}
        counts={{
          all: journeys.length,
          upcoming: upcomingCount,
          active: activeCount,
          completed: completedCount,
          cancelled: cancelledCount,
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filteredCount={filteredJourneys.length}
        onReset={() => {
          setFilterTab('ALL');
          setSearchQuery('');
        }}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        isExportDisabled={filteredJourneys.length === 0}
      />

      {/* Export notification toast/feedback banner */}
      {exportNotice && (
        <div className="bg-teal-50 border border-teal-200 text-teal-900 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between shadow-2xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
            <span>{exportNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="text-teal-700 hover:text-teal-900 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Banner if API fails */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <span className="font-bold block">Could not load journey records</span>
            <span className="text-rose-700 mt-0.5 block">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchJourneys(true)}
            className="px-3 py-1 bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* View Switcher: Card List vs Activity Timeline Board */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 pt-1 pb-1">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setDashboardView('CARDS')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              dashboardView === 'CARDS'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-teal-600" />
            <span>Card List View</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDashboardView('TIMELINE_BOARD');
              if (!selectedTimelineBoardJourneyId && filteredJourneys.length > 0) {
                setSelectedTimelineBoardJourneyId(filteredJourneys[0].id);
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              dashboardView === 'TIMELINE_BOARD'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-teal-600" />
            <span>Activity Timeline Tracker</span>
          </button>
        </div>

        <div className="text-[11px] text-slate-500 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Showing {filteredJourneys.length} journeys ({upcomingCount} upcoming)</span>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white p-5 rounded-2xl border border-slate-200 animate-pulse space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                <div className="h-6 bg-slate-200 rounded-full w-24"></div>
              </div>
              <div className="h-3 bg-slate-100 rounded w-2/3"></div>
              <div className="h-3 bg-slate-100 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : dashboardView === 'TIMELINE_BOARD' ? (
        /* DEDICATED TIMELINE BOARD VIEW */
        <div className="space-y-4">
          {filteredJourneys.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
              No journeys match current filter to display in timeline board.
            </div>
          ) : (
            (() => {
              const activeBoardJourney =
                filteredJourneys.find((j) => j.id === selectedTimelineBoardJourneyId) ||
                filteredJourneys[0];
              const partner = activeBoardJourney.carePartnerId
                ? partnerProfiles[activeBoardJourney.carePartnerId]
                : null;

              return (
                <div className="space-y-4">
                  {/* Journey Selector Strip */}
                  <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2 px-1">
                      Select Scheduled or Past Journey to Track Status Updates:
                    </span>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                      {filteredJourneys.map((j) => {
                        const isChosen = j.id === activeBoardJourney.id;
                        return (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => setSelectedTimelineBoardJourneyId(j.id)}
                            className={`shrink-0 text-left px-3.5 py-2.5 rounded-xl border transition-all cursor-pointer ${
                              isChosen
                                ? 'bg-teal-600 text-white border-teal-600 shadow-2xs ring-2 ring-teal-200'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-bold truncate max-w-[150px] ${isChosen ? 'text-white' : 'text-slate-900'}`}>
                                {j.hospitalDestination.name}
                              </span>
                              {j.bookingType === 'SCHEDULED' && (
                                <span className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${isChosen ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-800'}`}>
                                  Sched
                                </span>
                              )}
                            </div>
                            <div className={`text-[10px] mt-0.5 flex items-center justify-between gap-2 ${isChosen ? 'text-teal-100' : 'text-slate-500'}`}>
                              <span>{j.currentState.replace(/_/g, ' ')}</span>
                              <span>{formatDate(j.scheduledPickupTime || j.createdAt)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Render the full JourneyActivityTimeline */}
                  <JourneyActivityTimeline
                    journey={activeBoardJourney}
                    carePartner={partner}
                    onViewLiveTracker={onSelectJourney}
                  />
                </div>
              );
            })()
          )}
        </div>
      ) : filteredJourneys.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 sm:p-12 text-center space-y-3">
          <div className="inline-flex p-3 bg-slate-100 text-slate-400 rounded-2xl">
            <Calendar className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {searchQuery
              ? 'No journeys match your search query'
              : filterTab === 'UPCOMING'
              ? 'No upcoming scheduled journeys'
              : filterTab === 'ACTIVE'
              ? 'No active medical transports running right now'
              : filterTab === 'COMPLETED'
              ? 'No past completed visits recorded yet'
              : 'No medical journeys found'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {searchQuery
              ? `Try adjusting your search terms or clearing the filter.`
              : `When you schedule or request a companion for clinical procedures, appointments, or discharges, status and real-time transit details will appear here.`}
          </p>
          {onRequestBooking && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onRequestBooking}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Book New Transport
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Journeys List Cards */
        <div className="space-y-3">
          {filteredJourneys.map((journey) => {
            const partner = journey.carePartnerId ? partnerProfiles[journey.carePartnerId] : null;
            const isSelected = selectedJourneyId === journey.id;
            const active = isActiveTransport(journey);
            const upcoming = isUpcoming(journey);

            return (
              <div
                key={journey.id}
                onClick={() => {
                  setSelectedJourneyId(isSelected ? null : journey.id);
                  if (onSelectJourney) onSelectJourney(journey);
                }}
                className={`bg-white rounded-2xl border transition-all cursor-pointer hover:shadow-sm ${
                  active
                    ? 'border-teal-300 ring-1 ring-teal-200/60 bg-linear-to-r from-teal-50/20 via-white to-white'
                    : upcoming
                    ? 'border-blue-200/80 bg-linear-to-r from-blue-50/20 via-white to-white'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <div className="p-4 sm:p-5">
                  {/* Card Header: Badges & Dates */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderStatusBadge(journey.currentState, journey.bookingType)}

                      {journey.bookingType === 'SCHEDULED' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-md">
                          <Calendar className="w-3 h-3 text-blue-600" />
                          <span>Scheduled</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          <span>On-Demand</span>
                        </span>
                      )}

                      {journey.isRoundTrip && (
                        <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-md">
                          Round-Trip Care
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span>ID: {journey.id.slice(0, 8)}...</span>
                      <span>•</span>
                      <span className="text-slate-500 font-sans">
                        {formatDate(journey.scheduledPickupTime || journey.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Card Body: Route Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3.5">
                    {/* Origin & Destination */}
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg shrink-0 mt-0.5">
                          <MapPin className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                            Pickup Location
                          </span>
                          <span className="text-xs font-medium text-slate-800 line-clamp-1">
                            {journey.pickupLocation?.address || 'Patient Residence'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-teal-50 text-teal-700 rounded-lg shrink-0 mt-0.5">
                          <Building2 className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider block">
                            Hospital Destination
                          </span>
                          <span className="text-xs font-bold text-slate-900 block">
                            {journey.hospitalDestination?.name || 'Medical Center'}
                          </span>
                          {journey.hospitalDestination?.address && (
                            <span className="text-[11px] text-slate-500 line-clamp-1">
                              {journey.hospitalDestination.address}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Companion & Fare Details */}
                    <div className="flex flex-col justify-between space-y-2 border-t md:border-t-0 md:border-l md:border-slate-100 md:pl-4 pt-2 md:pt-0">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                          Assigned Care Partner
                        </span>
                        {partner ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                              <HeartHandshake className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-slate-800 block">
                                Companion Assigned ({partner.verificationStatus})
                              </span>
                              <span className="text-[10px] text-slate-500 block">
                                {partner.vehicle
                                  ? `${partner.vehicle.make} ${partner.vehicle.model} • ${partner.vehicle.licensePlate}`
                                  : 'Assistance Vehicle Verified'}
                              </span>
                            </div>
                          </div>
                        ) : journey.carePartnerId ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                              <HeartHandshake className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-slate-800 block">
                                Care Partner Assigned
                              </span>
                              <span className="text-[10px] text-slate-500 block">
                                ID: {journey.carePartnerId.slice(0, 8)}...
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>Auto-matching companion upon dispatch</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                            Fare Estimate
                          </span>
                          <span className="font-bold text-slate-900">
                            {journey.fareEstimate
                              ? `₹${journey.fareEstimate.total}`
                              : journey.initialFareEstimate
                              ? `₹${journey.initialFareEstimate.total}`
                              : 'Standard Care Fare'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJourneyId(isSelected && (journeySubTabs[journey.id] || 'TIMELINE') === 'TIMELINE' ? null : journey.id);
                              setJourneySubTabs((prev) => ({ ...prev, [journey.id]: 'TIMELINE' }));
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg text-[11px] font-bold border border-teal-200 transition-colors cursor-pointer"
                          >
                            <Clock className="w-3.5 h-3.5 text-teal-600" />
                            <span>Activity Timeline</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJourneyId(isSelected && journeySubTabs[journey.id] === 'MAP' ? null : journey.id);
                              setJourneySubTabs((prev) => ({ ...prev, [journey.id]: 'MAP' }));
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition-colors cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5 text-slate-500" />
                            <span>Route Map</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Special Notes if available */}
                  {journey.specialAssistanceNotes && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50/60 px-3 py-1.5 rounded-lg">
                      <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="truncate">Notes: {journey.specialAssistanceNotes}</span>
                    </div>
                  )}

                  {/* Expanded Section: Activity Timeline OR Mini Google Maps Route Preview */}
                  {isSelected && (
                    <div className="mt-4 pt-3.5 border-t border-slate-100 space-y-3">
                      {/* Sub-tab Switcher */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setJourneySubTabs((prev) => ({ ...prev, [journey.id]: 'TIMELINE' }));
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              (journeySubTabs[journey.id] || 'TIMELINE') === 'TIMELINE'
                                ? 'bg-teal-600 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Activity Timeline ({journey.stateHistory?.length || 1} Events)</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setJourneySubTabs((prev) => ({ ...prev, [journey.id]: 'MAP' }));
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              journeySubTabs[journey.id] === 'MAP'
                                ? 'bg-teal-600 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>Route Map Preview</span>
                          </button>
                        </div>

                        <span className="text-[10px] text-slate-400 font-mono">
                          ID: {journey.id}
                        </span>
                      </div>

                      {/* Content view */}
                      {(journeySubTabs[journey.id] || 'TIMELINE') === 'TIMELINE' ? (
                        <JourneyActivityTimeline
                          journey={journey}
                          carePartner={partner}
                          onViewLiveTracker={onSelectJourney}
                        />
                      ) : (
                        <div className="space-y-2">
                          <JourneyMiniRouteMap
                            journey={journey}
                            onOpenLiveTracker={onSelectJourney}
                            defaultHeight={280}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Info / Refresh Note */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
        <span>Displaying journeys from Neravu Medical Service</span>
        {lastRefreshedAt && <span>Synced at {lastRefreshedAt}</span>}
      </div>
    </div>
  );
};
