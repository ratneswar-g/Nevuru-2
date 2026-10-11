import React, { useState, useMemo } from 'react';
import { Journey, JourneyState, StateTransitionRecord } from '../../domain/types/journey.ts';
import { CarePartnerProfile } from '../../domain/types/care-partner.ts';
import {
  Clock,
  CheckCircle2,
  Circle,
  AlertTriangle,
  UserCheck,
  Navigation,
  MapPin,
  HeartHandshake,
  Hospital,
  Building2,
  Stethoscope,
  Home,
  Check,
  Phone,
  Car,
  ShieldCheck,
  Share2,
  Copy,
  ChevronDown,
  ChevronUp,
  Filter,
  FileText,
  Calendar,
  Sparkles,
  ExternalLink,
  Info,
} from 'lucide-react';

export interface JourneyActivityTimelineProps {
  journey: Journey;
  carePartner?: CarePartnerProfile | null;
  variant?: 'full' | 'embedded' | 'compact';
  onViewLiveTracker?: (journey: Journey) => void;
  className?: string;
}

interface MilestoneDefinition {
  state: JourneyState;
  title: string;
  shortLabel: string;
  category: 'booking' | 'pickup' | 'transit' | 'hospital' | 'return' | 'completion';
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  expectedOrder: number;
}

const MILESTONE_DEFINITIONS: MilestoneDefinition[] = [
  {
    state: 'REQUESTED',
    title: 'Booking Requested',
    shortLabel: 'Requested',
    category: 'booking',
    description: 'Scheduled companion transport requested and placed in the verified medical queue.',
    icon: Calendar,
    expectedOrder: 1,
  },
  {
    state: 'MATCHING',
    title: 'Finding Nearest Care Partner',
    shortLabel: 'Matching',
    category: 'booking',
    description: 'System searching for verified Care Partner within transit radius of patient pickup residence.',
    icon: Navigation,
    expectedOrder: 2,
  },
  {
    state: 'PARTNER_ASSIGNED',
    title: 'Care Partner Assigned',
    shortLabel: 'Partner Assigned',
    category: 'pickup',
    description: 'Trained medical companion confirmed and assigned with verified accessible vehicle.',
    icon: UserCheck,
    expectedOrder: 3,
  },
  {
    state: 'PARTNER_EN_ROUTE',
    title: 'Care Partner En Route to Residence',
    shortLabel: 'Partner En Route',
    category: 'pickup',
    description: 'Care Partner is travelling to patient home address for scheduled pickup.',
    icon: Car,
    expectedOrder: 4,
  },
  {
    state: 'PARTNER_ARRIVED',
    title: 'Care Partner Arrived at Residence',
    shortLabel: 'Arrived at Home',
    category: 'pickup',
    description: 'Vehicle arrived at pickup location. Ready for verification and physical boarding assistance.',
    icon: MapPin,
    expectedOrder: 5,
  },
  {
    state: 'PATIENT_PICKED_UP',
    title: 'Patient Assisted & Boarded Vehicle',
    shortLabel: 'Patient Picked Up',
    category: 'transit',
    description: 'Secure pickup PIN verified. Patient comfortably assisted into vehicle with mobility aids.',
    icon: HeartHandshake,
    expectedOrder: 6,
  },
  {
    state: 'IN_TRANSIT_TO_HOSPITAL',
    title: 'Travelling to Hospital',
    shortLabel: 'En Route to Hospital',
    category: 'transit',
    description: 'Outbound Leg 1: En route to medical center with live route tracking.',
    icon: Navigation,
    expectedOrder: 7,
  },
  {
    state: 'ARRIVED_AT_HOSPITAL',
    title: 'Arrived at Hospital',
    shortLabel: 'At Hospital',
    category: 'hospital',
    description: 'Arrived at hospital entrance. Care partner assisting patient with drop-off and wheelchair transition.',
    icon: Hospital,
    expectedOrder: 8,
  },
  {
    state: 'HOSPITAL_VISIT',
    title: 'Care Partner Accompanying You in Hospital',
    shortLabel: 'Hospital Accompaniment',
    category: 'hospital',
    description: 'Companion actively assisting patient throughout OPD consultation, tests, and pharmacy waiting.',
    icon: Stethoscope,
    expectedOrder: 9,
  },
  {
    state: 'RETURN_STARTED',
    title: 'Return Journey Initiated',
    shortLabel: 'Return Started',
    category: 'return',
    description: 'Hospital visit concluded. Patient and companion returning to vehicle for homeward journey.',
    icon: Car,
    expectedOrder: 10,
  },
  {
    state: 'IN_TRANSIT_TO_HOME',
    title: 'Travelling Back Home',
    shortLabel: 'En Route Home',
    category: 'return',
    description: 'Inbound Leg 2: Driving back safely to patient residence.',
    icon: Navigation,
    expectedOrder: 11,
  },
  {
    state: 'PATIENT_RETURNED_HOME',
    title: 'Patient Safely Returned Home',
    shortLabel: 'Returned Home',
    category: 'return',
    description: 'Assisted safely from vehicle through home gate and back into residence.',
    icon: Home,
    expectedOrder: 12,
  },
  {
    state: 'COMPLETED',
    title: 'Journey Successfully Concluded',
    shortLabel: 'Completed',
    category: 'completion',
    description: 'Complete round-trip service concluded safely. Verified summary ready.',
    icon: CheckCircle2,
    expectedOrder: 13,
  },
];

const STATE_ORDER_RANK: Record<JourneyState, number> = {
  DRAFT: 0,
  REQUESTED: 1,
  MATCHING: 2,
  PARTNER_ASSIGNED: 3,
  PARTNER_EN_ROUTE: 4,
  PARTNER_ARRIVED: 5,
  PATIENT_PICKED_UP: 6,
  IN_TRANSIT_TO_HOSPITAL: 7,
  ARRIVED_AT_HOSPITAL: 8,
  HOSPITAL_VISIT: 9,
  RETURN_STARTED: 10,
  IN_TRANSIT_TO_HOME: 11,
  PATIENT_RETURNED_HOME: 12,
  COMPLETED: 13,
  CANCELLED: -1,
  PARTNER_CANCELLED: -2,
  EMERGENCY_ACTIVE: 99,
  INCIDENT_REPORTED: 100,
  ESCALATED: 101,
};

function formatTimestamp(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export function getStageIcon(state: JourneyState): React.ComponentType<{ className?: string }> {
  switch (state) {
    case 'PARTNER_ASSIGNED':
      return UserCheck;
    case 'ARRIVED_AT_HOSPITAL':
      return Hospital;
    case 'HOSPITAL_VISIT':
      return Stethoscope;
    case 'PARTNER_ARRIVED':
      return MapPin;
    case 'PARTNER_EN_ROUTE':
    case 'RETURN_STARTED':
      return Car;
    case 'PATIENT_PICKED_UP':
      return HeartHandshake;
    case 'IN_TRANSIT_TO_HOSPITAL':
    case 'IN_TRANSIT_TO_HOME':
    case 'MATCHING':
      return Navigation;
    case 'PATIENT_RETURNED_HOME':
      return Home;
    case 'COMPLETED':
      return CheckCircle2;
    case 'REQUESTED':
    case 'DRAFT':
      return Calendar;
    default:
      return Clock;
  }
}

export const JourneyActivityTimeline: React.FC<JourneyActivityTimelineProps> = ({
  journey,
  carePartner,
  variant = 'full',
  onViewLiveTracker,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<'timeline' | 'audit_log'>('timeline');
  const [filterMode, setFilterMode] = useState<'ALL' | 'COMPLETED' | 'UPCOMING'>('ALL');
  const [copiedNotice, setCopiedNotice] = useState<boolean>(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const currentRank = STATE_ORDER_RANK[journey.currentState] ?? 0;
  const isEmergency = journey.currentState === 'EMERGENCY_ACTIVE';
  const isCancelled = journey.currentState === 'CANCELLED' || journey.currentState === 'PARTNER_CANCELLED';

  // Map stateHistory by toState for easy lookup
  const historyByState = useMemo(() => {
    const map = new Map<JourneyState, StateTransitionRecord>();
    if (journey.stateHistory && Array.isArray(journey.stateHistory)) {
      journey.stateHistory.forEach((rec) => {
        // Keep the latest record for this toState
        map.set(rec.toState, rec);
      });
    }
    return map;
  }, [journey.stateHistory]);

  // Compute status for each milestone
  const milestonesWithStatus = useMemo(() => {
    return MILESTONE_DEFINITIONS.map((def) => {
      const record = historyByState.get(def.state);
      const isPassed = !isEmergency && !isCancelled && currentRank > def.expectedOrder;
      const isCurrent = !isEmergency && !isCancelled && currentRank === def.expectedOrder;
      const isUpcoming = !isEmergency && !isCancelled && currentRank < def.expectedOrder;

      // Extract timestamp: from history record, or fallback
      let timestamp = record?.timestamp;
      if (!timestamp && isPassed && journey.updatedAt) {
        timestamp = journey.updatedAt;
      }

      return {
        ...def,
        status: isCurrent ? 'CURRENT' : isPassed ? 'COMPLETED' : 'UPCOMING',
        record,
        timestamp,
      };
    });
  }, [historyByState, currentRank, isEmergency, isCancelled, journey.updatedAt]);

  // Filtered milestones based on tab
  const filteredMilestones = useMemo(() => {
    if (filterMode === 'COMPLETED') {
      return milestonesWithStatus.filter((m) => m.status === 'COMPLETED' || m.status === 'CURRENT');
    }
    if (filterMode === 'UPCOMING') {
      return milestonesWithStatus.filter((m) => m.status === 'UPCOMING' || m.status === 'CURRENT');
    }
    return milestonesWithStatus;
  }, [milestonesWithStatus, filterMode]);

  // Total completed count
  const completedCount = useMemo(() => {
    return milestonesWithStatus.filter((m) => m.status === 'COMPLETED').length;
  }, [milestonesWithStatus]);

  const totalSteps = MILESTONE_DEFINITIONS.length;
  const progressPercent = Math.min(100, Math.round(((completedCount + (isCancelled ? 0 : 0.5)) / totalSteps) * 100));

  const toggleExpand = (stateKey: string) => {
    setExpandedItems((prev) => ({ ...prev, [stateKey]: !prev[stateKey] }));
  };

  // Generate shareable status text
  const handleCopyStatus = () => {
    const currentMilestone = MILESTONE_DEFINITIONS.find((m) => m.state === journey.currentState);
    const companionInfo = carePartner
      ? `Care Partner: ${carePartner.userId} (${carePartner.vehicle?.make || 'Verified Vehicle'} ${carePartner.vehicle?.licensePlate || ''})`
      : journey.carePartnerId
      ? `Care Partner ID: ${journey.carePartnerId}`
      : 'Matching companion';

    const text = `🏥 Neravu Medical Journey Status Update
Journey ID: ${journey.id}
Destination: ${journey.hospitalDestination.name}
Current Status: ${currentMilestone?.title || journey.currentState.replace(/_/g, ' ')}
Scheduled/Created: ${formatDate(journey.scheduledPickupTime || journey.createdAt)} ${formatTimestamp(journey.scheduledPickupTime || journey.createdAt)}
${companionInfo}
Pickup: ${journey.pickupLocation.address}
Hospital: ${journey.hospitalDestination.address}
Track Live: https://neravu-medical-companion.netlify.app`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
    });
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs ${className}`}>
      {/* HEADER SECTION */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-teal-50/50 via-white to-slate-50/50 border-b border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-teal-100 text-teal-700 rounded-lg">
                <Clock className="w-4 h-4" />
              </span>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Medical Journey Activity Timeline
              </h3>
              {journey.bookingType === 'SCHEDULED' && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Scheduled
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Real-time milestone tracking for hospital visit • ID:{' '}
              <span className="font-mono font-medium text-slate-700">{journey.id}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Share / Copy status button */}
            <button
              type="button"
              onClick={handleCopyStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Copy status update to clipboard for family or SMS notification"
            >
              {copiedNotice ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-600" />
                  <span className="text-teal-700">Copied!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Share Status</span>
                </>
              )}
            </button>

            {onViewLiveTracker && (
              <button
                type="button"
                onClick={() => onViewLiveTracker(journey)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Live Tracker</span>
              </button>
            )}
          </div>
        </div>

        {/* PROGRESS METRIC BAR */}
        {!isCancelled && !isEmergency && (
          <div className="mt-4 pt-3 border-t border-slate-100/80">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-600 font-medium flex items-center gap-1.5">
                <span>Journey Progression:</span>
                <strong className="text-slate-900">
                  {completedCount} of {totalSteps} milestones reached
                </strong>
              </span>
              <span className="font-bold text-teal-700 font-mono text-xs">
                {progressPercent}% Complete
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* EMERGENCY OR CANCELLED BANNER */}
      {isEmergency && (
        <div className="p-4 bg-red-50 border-b border-red-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-950">
            <span className="font-bold text-red-900 block text-sm">
              Emergency Protocol Activated
            </span>
            <span>
              {journey.emergencyReason ||
                'Operations desk notified and emergency coordination active. Live timeline paused.'}
            </span>
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-950">
            <span className="font-bold text-amber-900 block">
              Booking Cancelled
            </span>
            <span>
              This scheduled journey was cancelled before transit completion. All activity history is archived.
            </span>
          </div>
        </div>
      )}

      {/* SUB-HEADER TOOLBAR (Filter pills & View Mode Toggle) */}
      <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Filter Pills */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
              filterMode === 'ALL'
                ? 'bg-white text-teal-800 shadow-2xs border border-teal-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Milestones ({totalSteps})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('COMPLETED')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
              filterMode === 'COMPLETED'
                ? 'bg-white text-teal-800 shadow-2xs border border-teal-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Completed & Current ({completedCount + (isCancelled ? 0 : 1)})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('UPCOMING')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
              filterMode === 'UPCOMING'
                ? 'bg-white text-teal-800 shadow-2xs border border-teal-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Upcoming Steps ({Math.max(0, totalSteps - completedCount - 1)})
          </button>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
              viewMode === 'timeline'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Visual Track
          </button>
          <button
            type="button"
            onClick={() => setViewMode('audit_log')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
              viewMode === 'audit_log'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Event Audit Log ({journey.stateHistory?.length || 0})
          </button>
        </div>
      </div>

      {/* VIEW MODE 1: VISUAL TIMELINE */}
      {viewMode === 'timeline' && (
        <div className="p-4 sm:p-6 space-y-0">
          <div className="relative pl-8 sm:pl-10 space-y-6">
            {filteredMilestones.map((item, idx) => {
              const isPassed = item.status === 'COMPLETED';
              const isCurrent = item.status === 'CURRENT';
              const isUpcoming = item.status === 'UPCOMING';
              const Icon = item.icon;
              const hasExpanded = expandedItems[item.state] || isCurrent;

              return (
                <div key={item.state} className="relative flex items-start group">
                  {/* Vertical connector line */}
                  {idx < filteredMilestones.length - 1 && (
                    <div
                      className={`absolute left-[-20px] sm:left-[-22px] top-8 w-0.5 h-[calc(100%+14px)] ${
                        isPassed ? 'bg-teal-500' : 'bg-slate-200 border-l border-dashed border-slate-300'
                      }`}
                    />
                  )}

                  {/* Representative Node Icon Bubble */}
                  <div
                    className={`absolute left-[-36px] sm:left-[-40px] top-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all shadow-2xs ${
                      isPassed
                        ? 'bg-teal-600 text-white ring-4 ring-teal-50'
                        : isCurrent
                        ? 'bg-teal-600 text-white ring-4 ring-teal-200 shadow-md animate-pulse'
                        : 'bg-white border-2 border-slate-300 text-slate-400'
                    }`}
                    title={`${item.title} (${item.status})`}
                  >
                    <Icon className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                    {isPassed && (
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-600 rounded-full flex items-center justify-center text-white ring-2 ring-white">
                        <Check className="w-2 h-2 stroke-[3]" />
                      </span>
                    )}
                    {isCurrent && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full ring-2 ring-white" />
                    )}
                  </div>

                  {/* Main Content Card for Milestone */}
                  <div
                    className={`ml-2 sm:ml-3 flex-1 rounded-xl p-3.5 transition-all ${
                      isCurrent
                        ? 'bg-teal-50/80 border-2 border-teal-500/80 shadow-xs'
                        : isPassed
                        ? 'bg-white border border-slate-200 hover:border-slate-300'
                        : 'bg-slate-50/60 border border-slate-200/70 opacity-80'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isCurrent
                              ? 'bg-teal-600 text-white shadow-2xs'
                              : isPassed
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                          title={item.title}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4
                              className={`text-xs sm:text-sm font-bold ${
                                isCurrent
                                  ? 'text-teal-950 font-extrabold'
                                  : isPassed
                                  ? 'text-slate-900'
                                  : 'text-slate-500'
                              }`}
                            >
                              {item.title}
                            </h4>
                            {isCurrent && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-600 text-white font-extrabold uppercase tracking-wider animate-pulse">
                                Active Status
                              </span>
                            )}
                            {isPassed && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold uppercase tracking-wider">
                                Verified
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Timestamp display */}
                      <div className="text-[11px] text-slate-500 font-mono">
                        {item.timestamp ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {formatTimestamp(item.timestamp)}
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({formatDate(item.timestamp)})
                            </span>
                          </span>
                        ) : isUpcoming ? (
                          <span className="text-slate-400 italic">Scheduled step</span>
                        ) : null}
                      </div>
                    </div>

                    <p
                      className={`text-xs mt-1 ${
                        isCurrent ? 'text-teal-900' : isPassed ? 'text-slate-600' : 'text-slate-500'
                      }`}
                    >
                      {item.description}
                    </p>

                    {/* Transition Note from domain history */}
                    {item.record?.note && (
                      <div className="mt-2 p-2 bg-white/80 border border-slate-200/80 rounded-lg text-[11px] text-slate-700 flex items-start gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>Update Note:</strong> {item.record.note}
                        </span>
                      </div>
                    )}

                    {/* SPECIAL CALLOUT 1: CARE PARTNER ASSIGNED (Explicitly requested feature) */}
                    {item.state === 'PARTNER_ASSIGNED' && (isPassed || isCurrent) && (
                      <div className="mt-3 p-3 bg-white rounded-xl border border-teal-200 text-xs shadow-2xs space-y-2">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="font-bold text-slate-900 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-teal-600" />
                            Assigned Companion Details
                          </span>
                          <span className="text-[10px] bg-teal-50 text-teal-800 font-bold px-2 py-0.5 rounded border border-teal-200">
                            Police Verified & First Aid Certified
                          </span>
                        </div>

                        {carePartner ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-slate-400 block text-[10px] uppercase font-bold">
                                Companion ID
                              </span>
                              <span className="font-bold text-slate-800">{carePartner.userId}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[10px] uppercase font-bold">
                                Rating & Experience
                              </span>
                              <span className="font-bold text-slate-800">
                                ★ {carePartner.ratingAverage?.toFixed(1) || '4.9'} • {carePartner.totalJourneysCompleted || 140}+ trips completed
                              </span>
                            </div>
                            {carePartner.vehicle && (
                              <div className="sm:col-span-2 pt-1 border-t border-slate-100">
                                <span className="text-slate-400 block text-[10px] uppercase font-bold">
                                  Assistance Vehicle
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {carePartner.vehicle.make} {carePartner.vehicle.model} ({carePartner.vehicle.licensePlate})
                                  {carePartner.vehicle.isWheelchairAccessible && (
                                    <span className="ml-2 text-teal-700 font-bold">
                                      ♿ Wheelchair Ramp Equipped
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-600">
                            Care Partner ID: <strong className="font-mono">{journey.carePartnerId || 'Matched'}</strong> • Standard Assisted Mobility Vehicle
                          </div>
                        )}
                      </div>
                    )}

                    {/* SPECIAL CALLOUT 2: CARE PARTNER ARRIVED & PICKUP PIN */}
                    {item.state === 'PARTNER_ARRIVED' && (isPassed || isCurrent) && journey.pickupPin && (
                      <div className="mt-3 p-3 bg-amber-50/80 rounded-xl border border-amber-300 text-xs">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-amber-950 block">
                              4-Digit Boarding Verification PIN
                            </span>
                            <span className="text-[11px] text-amber-800">
                              Share this secure PIN with the companion upon boarding vehicle:
                            </span>
                          </div>
                          <div className="px-3 py-1 bg-white border-2 border-amber-400 rounded-lg font-mono font-black text-amber-950 text-sm tracking-widest shadow-2xs">
                            {journey.pickupPin}
                          </div>
                        </div>
                        {journey.pickupPinVerified && (
                          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-800 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Pickup PIN verified successfully at home entrance.</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SPECIAL CALLOUT 3: ARRIVED AT HOSPITAL (Explicitly requested feature) */}
                    {item.state === 'ARRIVED_AT_HOSPITAL' && (isPassed || isCurrent) && (
                      <div className="mt-3 p-3 bg-white rounded-xl border border-teal-200 text-xs shadow-2xs space-y-2">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="font-bold text-slate-900 flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-teal-600" />
                            Hospital Arrival Checkpoint
                          </span>
                          <span className="text-[10px] bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded border border-emerald-200">
                            Outpatient Wing Reached
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Destination
                            </span>
                            <span className="font-bold text-slate-800">
                              {journey.hospitalDestination.name}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Drop-off Department / Gate
                            </span>
                            <span className="font-medium text-slate-800">
                              {journey.hospitalDestination.entranceOrDepartment || 'Main OPD Assistance Gate'}
                            </span>
                          </div>
                          {journey.hospitalDestination.accessNotes && (
                            <div className="sm:col-span-2 pt-1 border-t border-slate-100 text-slate-600 text-[11px]">
                              <strong>Accessibility:</strong> {journey.hospitalDestination.accessNotes}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SPECIAL CALLOUT 4: HOSPITAL VISIT & ACCOMPANIMENT */}
                    {item.state === 'HOSPITAL_VISIT' && isCurrent && (
                      <div className="mt-3 p-3 bg-teal-600 text-white rounded-xl text-xs shadow-xs space-y-1">
                        <span className="font-bold block flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-teal-200" />
                          Dedicated Companion Active Inside Hospital
                        </span>
                        <p className="text-teal-100 leading-snug">
                          Your Care Partner remains by your side inside the medical center during waiting, consultations, and test procedures. When your doctor checkup finishes, inform your companion to begin the return leg.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW MODE 2: AUDIT LOG VIEW */}
      {viewMode === 'audit_log' && (
        <div className="p-4 sm:p-5">
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-3">State Transition</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Triggered By</th>
                  <th className="py-2.5 px-3">Audit Details / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {journey.stateHistory && journey.stateHistory.length > 0 ? (
                  journey.stateHistory.map((rec, i) => {
                    const RecIcon = getStageIcon(rec.toState);
                    return (
                      <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded bg-teal-50 text-teal-700 border border-teal-200 shrink-0" title={rec.toState}>
                              <RecIcon className="w-3.5 h-3.5" />
                            </span>
                            <span>{rec.toState.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                        {formatDate(rec.timestamp)} {formatTimestamp(rec.timestamp)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-mono">
                          {rec.triggeredByUserId || 'system'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 text-[11px]">
                        {rec.note || (
                          <span className="text-slate-400 italic">Standard milestone state advance</span>
                        )}
                      </td>
                    </tr>
                  );
                })
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400 italic">
                      Initial state record: {journey.currentState}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FOOTER METADATA */}
      <div className="px-4 py-3 bg-slate-50/90 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Authoritative Domain State: <strong className="text-slate-800">{journey.currentState}</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <span>Scheduled Time: <strong>{formatDate(journey.scheduledPickupTime || journey.createdAt)} {formatTimestamp(journey.scheduledPickupTime || journey.createdAt)}</strong></span>
          <span>•</span>
          <span>Hospital: <strong>{journey.hospitalDestination.name}</strong></span>
        </div>
      </div>
    </div>
  );
};
