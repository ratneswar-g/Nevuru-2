import React from 'react';
import { Journey, JourneyState } from '../../domain/types/journey.ts';
import { CarePartnerProfile } from '../../domain/types/care-partner.ts';
import { JourneyActivityTimeline } from './JourneyActivityTimeline.tsx';
import {
  Check,
  Circle,
  AlertTriangle,
  Clock,
  UserCheck,
  Hospital,
  Stethoscope,
  Car,
  MapPin,
  HeartHandshake,
  Navigation,
  Home,
  CheckCircle2,
  Calendar,
} from 'lucide-react';

export interface JourneyTimelineProps {
  currentState?: JourneyState;
  journey?: Journey;
  carePartner?: CarePartnerProfile | null;
  onViewLiveTracker?: (journey: Journey) => void;
}

interface Milestone {
  key: JourneyState;
  label: string;
  sublabel: string;
  order: number;
  icon: React.ComponentType<{ className?: string }>;
}

const MILESTONES: Milestone[] = [
  { key: 'REQUESTED', label: 'Booking Requested', sublabel: 'Request received & matching nearest Care Partner', order: 1, icon: Calendar },
  { key: 'PARTNER_ASSIGNED', label: 'Care Partner Assigned', sublabel: 'Companion verified & assigned to your journey', order: 2, icon: UserCheck },
  { key: 'PARTNER_EN_ROUTE', label: 'Care Partner Travelling to You', sublabel: 'Companion en route to your home pickup', order: 3, icon: Car },
  { key: 'PARTNER_ARRIVED', label: 'Care Partner Arrived', sublabel: 'Companion arrived at your residence gate', order: 4, icon: MapPin },
  { key: 'PATIENT_PICKED_UP', label: 'Patient Assisted & Picked Up', sublabel: 'Comfortably assisted into the vehicle', order: 5, icon: HeartHandshake },
  { key: 'IN_TRANSIT_TO_HOSPITAL', label: 'Travelling to Hospital', sublabel: 'Outbound Leg 1: En route to medical facility', order: 6, icon: Navigation },
  { key: 'ARRIVED_AT_HOSPITAL', label: 'Arrived at Hospital', sublabel: 'Vehicle parked at patient assistance drop-off', order: 7, icon: Hospital },
  { key: 'HOSPITAL_VISIT', label: 'Care Partner Accompanying You in Hospital', sublabel: 'Companion stays with you during waiting & consultation', order: 8, icon: Stethoscope },
  { key: 'RETURN_STARTED', label: 'Return Journey Started', sublabel: 'Visit concluded, moving to vehicle for return leg', order: 9, icon: Car },
  { key: 'IN_TRANSIT_TO_HOME', label: 'Returning Home', sublabel: 'Inbound Leg 2: Driving back to patient residence', order: 10, icon: Navigation },
  { key: 'PATIENT_RETURNED_HOME', label: 'Patient Returned Home', sublabel: 'Safely assisted from vehicle back into residence', order: 11, icon: Home },
  { key: 'COMPLETED', label: 'Journey Completed', sublabel: 'Complete round-trip service concluded safely', order: 12, icon: CheckCircle2 },
];

const STATE_ORDER_MAP: Record<JourneyState, number> = {
  DRAFT: 0,
  REQUESTED: 1,
  MATCHING: 1,
  PARTNER_ASSIGNED: 2,
  PARTNER_EN_ROUTE: 3,
  PARTNER_ARRIVED: 4,
  PATIENT_PICKED_UP: 5,
  IN_TRANSIT_TO_HOSPITAL: 6,
  ARRIVED_AT_HOSPITAL: 7,
  HOSPITAL_VISIT: 8,
  RETURN_STARTED: 9,
  IN_TRANSIT_TO_HOME: 10,
  PATIENT_RETURNED_HOME: 11,
  COMPLETED: 12,
  CANCELLED: -1,
  PARTNER_CANCELLED: -2,
  EMERGENCY_ACTIVE: 99,
  ESCALATED: 100,
  INCIDENT_REPORTED: 101,
};

export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({
  currentState,
  journey,
  carePartner,
  onViewLiveTracker,
}) => {
  // If complete journey model is available, render the full activity timeline with timestamps and companion details
  if (journey) {
    return (
      <JourneyActivityTimeline
        journey={journey}
        carePartner={carePartner}
        onViewLiveTracker={onViewLiveTracker}
      />
    );
  }

  const effectiveState = currentState || 'REQUESTED';
  const currentOrder = STATE_ORDER_MAP[effectiveState] ?? 0;
  const isEmergency = effectiveState === 'EMERGENCY_ACTIVE';
  const isCancelled = effectiveState === 'CANCELLED' || effectiveState === 'PARTNER_CANCELLED';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-600" />
            Medical Journey Status
          </h3>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Milestones updated from domain state engine • Live milestone tracking
          </span>
        </div>
        <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200">
          State: {effectiveState}
        </span>
      </div>

      {isEmergency && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-900 text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          EMERGENCY PROTOCOL ACTIVE — Operations desk and emergency contacts alerted. Status snapshot preserved.
        </div>
      )}

      {isCancelled && (
        <div className="mb-4 p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-900 text-xs font-medium">
          Booking was cancelled prior to transit.
        </div>
      )}

      <div className="relative pl-8 space-y-5">
        {MILESTONES.map((m, idx) => {
          const isPassed = currentOrder > m.order;
          const isCurrent = currentOrder === m.order;
          const isHospitalVisit = m.key === 'HOSPITAL_VISIT';
          const Icon = m.icon;

          return (
            <div key={m.key} className="relative flex items-start group">
              {/* Vertical connector line */}
              {idx < MILESTONES.length - 1 && (
                <div
                  className={`absolute left-[-20px] top-7 w-0.5 h-[calc(100%+10px)] ${
                    isPassed ? 'bg-teal-500' : 'bg-slate-200 border-l border-dashed border-slate-300'
                  }`}
                />
              )}

              {/* Representative Status Stage Icon Bubble */}
              <div
                className={`absolute left-[-34px] top-0 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-2xs ${
                  isPassed
                    ? 'bg-teal-600 text-white ring-4 ring-teal-50'
                    : isCurrent
                    ? 'bg-teal-600 text-white ring-4 ring-teal-200 animate-pulse'
                    : 'bg-white border-2 border-slate-300 text-slate-400'
                }`}
                title={m.label}
              >
                <Icon className="w-3.5 h-3.5" />
                {isPassed && (
                  <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-600 rounded-full flex items-center justify-center text-white ring-2 ring-white">
                    <Check className="w-2 h-2 stroke-[3]" />
                  </span>
                )}
              </div>

              {/* Label & Description */}
              <div className="ml-2 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`p-1 rounded-md shrink-0 ${
                      isCurrent
                        ? 'bg-teal-600 text-white'
                        : isPassed
                        ? 'bg-teal-100 text-teal-800'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      isCurrent
                        ? 'text-teal-950 font-extrabold'
                        : isPassed
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {m.label}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-100 text-teal-800 font-bold uppercase tracking-wider">
                      Current Milestone
                    </span>
                  )}
                  {isPassed && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 font-bold uppercase tracking-wider">
                      Done
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] mt-0.5 ml-6 ${
                    isCurrent
                      ? 'text-teal-700 font-medium'
                      : isPassed
                      ? 'text-slate-500'
                      : 'text-slate-400'
                  }`}
                >
                  {m.sublabel}
                </p>

                {/* Special Highlight for Hospital Visit */}
                {isHospitalVisit && isCurrent && (
                  <div className="mt-2 p-2.5 bg-teal-50/90 border border-teal-300 rounded-lg text-teal-950 text-xs shadow-2xs">
                    <span className="font-bold block mb-0.5 text-teal-900">
                      Companion On-Site Accompaniment Active
                    </span>
                    Care Partner is actively waiting with you at the clinic. Your round-trip booking remains open. When your appointment concludes, tap "Ready to return home".
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { JourneyActivityTimeline };
