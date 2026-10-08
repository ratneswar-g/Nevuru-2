import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { neravuApi } from '../../services/api-client.ts';
import { Journey, CarePartnerProfile, JourneyState, CarePartnerComplianceSummary, ComplianceDocument, ComplianceDocumentType } from '../../domain/types/index.ts';
import { JourneyTimeline } from '../common/JourneyTimeline.tsx';
import { EmergencyModal } from '../common/EmergencyModal.tsx';
import { NeravuJourneyMap } from '../maps/NeravuJourneyMap.tsx';
import {
  HeartHandshake,
  Car,
  Key,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldAlert,
  Power,
  User,
  Navigation,
  RefreshCw,
  WifiOff,
  FileCheck,
  FileText,
  Upload,
  Plus,
} from 'lucide-react';

export const CarePartnerPortal: React.FC = () => {
  const { currentUser } = useAuth();
  const [partnerProfile, setPartnerProfile] = useState<CarePartnerProfile | null>(null);
  const [complianceSummary, setComplianceSummary] = useState<CarePartnerComplianceSummary | null>(null);
  const [showDocUploadModal, setShowDocUploadModal] = useState<boolean>(false);
  const [docFormType, setDocFormType] = useState<ComplianceDocumentType>('DRIVING_LICENCE');
  const [docFormNumber, setDocFormNumber] = useState<string>('');
  const [docFormExpiry, setDocFormExpiry] = useState<string>('');
  const [docFormIssue, setDocFormIssue] = useState<string>('');
  const [docFormSubmitting, setDocFormSubmitting] = useState<boolean>(false);
  const [docFormError, setDocFormError] = useState<string | null>(null);
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [offeredJourneys, setOfferedJourneys] = useState<Journey[]>([]);
  const [isSosOpen, setIsSosOpen] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(new Date().toLocaleTimeString());
  const [pickupPinInput, setPickupPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  const loadData = async () => {
    if (!currentUser) return;
    try {
      const [profile, journeys, compliance] = await Promise.all([
        neravuApi.getCarePartnerProfile(currentUser.id),
        neravuApi.getJourneys(),
        neravuApi.getCarePartnerCompliance(currentUser.id).catch(() => null),
      ]);

      setPartnerProfile(profile);
      setComplianceSummary(compliance);

      // Active journey: Assigned to this partner and not COMPLETED / CANCELLED
      const assigned = journeys.find(
        (j) => j.carePartnerId === currentUser.id && j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
      ) || null;
      setActiveJourney(assigned);

      // Offered journeys: Currently in MATCHING state
      const offered = journeys.filter((j) => j.currentState === 'MATCHING');
      setOfferedJourneys(offered);

      setLastSyncedTime(new Date().toLocaleTimeString());
      setApiError(null);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Unable to connect to the Neravu server.');
    }
  };

  const handleSubmitDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!docFormNumber || docFormNumber.trim().length < 3) {
      setDocFormError('Please enter a valid document number or reference.');
      return;
    }
    if (!docFormExpiry) {
      setDocFormError('Please select a valid expiry date.');
      return;
    }
    setDocFormSubmitting(true);
    setDocFormError(null);
    try {
      const res = await neravuApi.submitComplianceDocument(currentUser.id, {
        type: docFormType,
        documentNumber: docFormNumber.trim(),
        expiryDate: docFormExpiry,
        issueDate: docFormIssue || undefined,
      });
      setComplianceSummary(res.summary);
      setShowDocUploadModal(false);
      setDocFormNumber('');
      setDocFormExpiry('');
      setDocFormIssue('');
      await loadData();
    } catch (err: any) {
      setDocFormError(err.userFriendlyMessage || err.message || 'Failed to submit compliance document.');
    } finally {
      setDocFormSubmitting(false);
    }
  };

  useEffect(() => {
    loadData();
    // Conservative HTTP polling: every 4 seconds to sync dispatch offers and milestone status
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Live in-transit geolocation tracking
  // Active states: PARTNER_EN_ROUTE, PATIENT_PICKED_UP, IN_TRANSIT_TO_HOSPITAL, RETURN_STARTED, IN_TRANSIT_TO_HOME
  useEffect(() => {
    if (!activeJourney) return;
    const TRANSIT_STATES: JourneyState[] = [
      'PARTNER_EN_ROUTE',
      'PATIENT_PICKED_UP',
      'IN_TRANSIT_TO_HOSPITAL',
      'RETURN_STARTED',
      'IN_TRANSIT_TO_HOME',
    ];
    if (!TRANSIT_STATES.includes(activeJourney.currentState)) return;

    let watchId: number | null = null;
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      const updateLocationToServer = async (pos: GeolocationPosition) => {
        try {
          await neravuApi.updateLocation(activeJourney.id, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
          });
        } catch {
          // Non-blocking in case of network dip
        }
      };

      navigator.geolocation.getCurrentPosition(updateLocationToServer, () => {});
      watchId = navigator.geolocation.watchPosition(updateLocationToServer, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      });
    }

    return () => {
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [activeJourney?.id, activeJourney?.currentState]);

  if (!currentUser) return null;

  // Toggle Availability via backend API
  const handleToggleAvailability = async () => {
    if (!partnerProfile) return;
    const newStatus = partnerProfile.availabilityStatus === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE';
    setIsActionLoading(true);
    setApiError(null);
    try {
      const updated = await neravuApi.setCarePartnerAvailability(newStatus);
      setPartnerProfile(updated);
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to update duty availability.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Accept Offered Journey via backend API
  const handleAcceptJourney = async (journeyId: string) => {
    setIsActionLoading(true);
    setApiError(null);
    try {
      await neravuApi.acceptJourney(journeyId);
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to accept journey.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Advance Journey Milestone via backend API
  const handleAdvanceMilestone = async (targetState: JourneyState, note?: string) => {
    if (!activeJourney) return;
    setIsActionLoading(true);
    setApiError(null);
    try {
      await neravuApi.advanceMilestone(activeJourney.id, targetState, { note });
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to advance milestone.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Verify Patient Pickup PIN via backend API
  const handleVerifyPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeJourney) return;
    const pin = pickupPinInput.trim();
    if (!pin || pin.length !== 4) {
      setPinError('Please enter the complete 4-digit PIN provided by the patient.');
      return;
    }
    setIsActionLoading(true);
    setPinError(null);
    setApiError(null);
    try {
      await neravuApi.verifyPickupPin(activeJourney.id, pin);
      setPickupPinInput('');
      await loadData();
    } catch (err: any) {
      setPinError(err.userFriendlyMessage || err.message || 'Incorrect pickup verification PIN.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Handle SOS via backend API
  const handleConfirmSos = async (reason: string, category?: any) => {
    if (!activeJourney || !currentUser) return;
    setApiError(null);
    try {
      await neravuApi.triggerEmergency(activeJourney.id, {
        category,
        reason,
        locationSnapshot: activeJourney.pickupLocation,
      });
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to trigger emergency.');
    }
  };

  // Determine Next Legitimate Action for Care Partner based on state
  const getNextAction = (state: JourneyState) => {
    switch (state) {
      case 'PARTNER_ASSIGNED':
        return {
          target: 'PARTNER_EN_ROUTE' as JourneyState,
          label: 'Start Travel to Patient Pickup',
          description: 'Signal that you are driving toward the patient residence',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PARTNER_EN_ROUTE':
        return {
          target: 'PARTNER_ARRIVED' as JourneyState,
          label: 'Mark Arrived at Patient Home',
          description: 'Signal arrival at the patient doorway/gate',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PARTNER_ARRIVED':
        return {
          target: 'PATIENT_PICKED_UP' as JourneyState,
          label: 'Confirm Patient Assisted & In Vehicle',
          description: 'Patient safely met and seated with seatbelt fastened',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PATIENT_PICKED_UP':
        return {
          target: 'IN_TRANSIT_TO_HOSPITAL' as JourneyState,
          label: 'Start Transit to Hospital (Leg 1)',
          description: 'Driving to medical destination facility',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'IN_TRANSIT_TO_HOSPITAL':
        return {
          target: 'ARRIVED_AT_HOSPITAL' as JourneyState,
          label: 'Mark Arrived at Hospital Drop-Off',
          description: 'Vehicle parked at hospital patient assistance bay',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'ARRIVED_AT_HOSPITAL':
        return {
          target: 'HOSPITAL_VISIT' as JourneyState,
          label: 'Begin Hospital Accompaniment & Waiting',
          description: 'Assist patient inside clinic; stay with patient during visit',
          color: 'bg-teal-600 hover:bg-teal-700',
        };
      case 'HOSPITAL_VISIT':
        return {
          target: 'RETURN_STARTED' as JourneyState,
          label: 'Start Return Journey (Visit Concluded)',
          description: 'Patient finished appointment; escorting back to vehicle',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'RETURN_STARTED':
        return {
          target: 'IN_TRANSIT_TO_HOME' as JourneyState,
          label: 'Start Transit Home (Leg 2)',
          description: 'Driving patient back to residence',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'IN_TRANSIT_TO_HOME':
        return {
          target: 'PATIENT_RETURNED_HOME' as JourneyState,
          label: 'Confirm Patient Safely Returned Home',
          description: 'Assisted patient from vehicle safely inside home entrance',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PATIENT_RETURNED_HOME':
        return {
          target: 'COMPLETED' as JourneyState,
          label: 'Complete Round-Trip Journey',
          description: 'Patient is safe indoors; service concluded',
          color: 'bg-emerald-600 hover:bg-emerald-700',
        };
      default:
        return null;
    }
  };

  const nextAction = activeJourney ? getNextAction(activeJourney.currentState) : null;

  return (
    <div className="space-y-6">
      {/* Network / Server Error Notice */}
      {apiError && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-amber-900 text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Server Communication Notice:</strong> {apiError}
            </span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              Care Partner Desk: {currentUser.name}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Verified Companion
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dedicated Medical Accompaniment & Safe Transport Service
          </p>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-2">
            <RefreshCw className="w-3 h-3 text-indigo-600 animate-spin-slow" />
            <span>Automatically refreshed from the server (Last sync: {lastSyncedTime})</span>
          </div>
        </div>

        {/* Availability Toggle */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Duty Status
            </span>
            <span
              className={`text-xs font-bold ${
                partnerProfile?.availabilityStatus === 'AVAILABLE'
                  ? 'text-emerald-600'
                  : partnerProfile?.availabilityStatus === 'ON_JOURNEY'
                  ? 'text-indigo-600'
                  : 'text-slate-400'
              }`}
            >
              {partnerProfile?.availabilityStatus}
            </span>
          </div>

          <button
            type="button"
            disabled={partnerProfile?.availabilityStatus === 'ON_JOURNEY'}
            onClick={handleToggleAvailability}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer disabled:opacity-50 ${
              partnerProfile?.availabilityStatus === 'AVAILABLE'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-slate-100 border-slate-300 text-slate-600'
            }`}
          >
            <Power className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Safety & Non-Clinical Scope Notice */}
      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 text-blue-950 flex items-start gap-3 text-xs leading-relaxed shadow-2xs">
        <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-blue-900 block mb-0.5">
            Care Partner Safety Boundary
          </span>
          Care Partners provide transportation, mobility assistance, physical escort, and hospital waiting accompaniment.
          Care Partners are <strong>strictly non-clinical companions</strong> and must never administer medication, medical treatment, or clinical procedures.
        </div>
      </div>

      {/* OFFERED JOURNEYS (MATCHING DISPATCHES) */}
      {!activeJourney && offeredJourneys.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 p-6 shadow-2xs">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-amber-600" />
            <h2 className="text-base font-bold text-slate-900">
              New Journey Dispatch Offers ({offeredJourneys.length})
            </h2>
          </div>

          <div className="space-y-4">
            {offeredJourneys.map((j) => (
              <div
                key={j.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Destination: {j.hospitalDestination.name}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-mono">
                      Round Trip
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    <span className="font-semibold">Pickup:</span> {j.pickupLocation.address}
                  </p>
                  <p className="text-xs text-slate-600">
                    <span className="font-semibold">Return Drop-Off:</span> {j.returnDropoffLocation.address}
                  </p>
                  {j.specialAssistanceNotes && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200 inline-block">
                      Note: {j.specialAssistanceNotes}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => handleAcceptJourney(j.id)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Accept Dispatch
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE ASSIGNED JOURNEY CONSOLE */}
      {activeJourney && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Interactive Journey Map */}
            <NeravuJourneyMap journey={activeJourney} />

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Active Assigned Journey
                  </span>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {activeJourney.hospitalDestination.name}
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono px-3 py-1 rounded-full bg-indigo-50 text-indigo-800 font-bold border border-indigo-200">
                    {activeJourney.currentState}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                    ID: {activeJourney.id}
                  </span>
                </div>
              </div>

              {/* CRITICAL HOSPITAL VISIT BANNER FOR PARTNER */}
              {activeJourney.currentState === 'HOSPITAL_VISIT' && (
                <div className="my-5 p-5 bg-teal-50 border-2 border-teal-500 rounded-2xl shadow-xs">
                  <div className="flex items-start gap-3">
                    <HeartHandshake className="w-6 h-6 text-teal-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-bold text-teal-950 uppercase tracking-wider block">
                        Hospital Accompaniment Protocol Active
                      </span>
                      <p className="text-xs text-teal-900 mt-1 leading-relaxed">
                        <strong>Stay with the patient during the hospital visit.</strong> The Care Partner does not leave.
                        Wait with the patient in the consultation / testing area. You are providing reassurance, mobility support, and return transport.
                      </p>
                      <span className="text-[11px] font-bold text-teal-800 block mt-2">
                        DO NOT attempt to complete the journey here. The booking completes only after safely returning the patient home.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Location details */}
              <div className="my-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Location Details (Domain Booking Endpoints)
                  </span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    {activeJourney.liveLocation ? (
                      activeJourney.liveLocation.isStale ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span>GPS Signal Stale</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-emerald-700 font-semibold">Broadcasting Live Transit GPS</span>
                        </>
                      )
                    ) : (
                      <span>GPS on stand-by</span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500">Pickup Address:</span>
                  <p className="font-semibold text-slate-900">{activeJourney.pickupLocation.address}</p>
                  <p className="text-slate-500 text-[11px]">Landmark: {activeJourney.pickupLocation.landmark}</p>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Hospital Bay / Clinic:</span>
                  <p className="font-semibold text-teal-900">{activeJourney.hospitalDestination.entranceOrDepartment || activeJourney.hospitalDestination.name}</p>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Return Drop-Off:</span>
                  <p className="font-semibold text-slate-900">{activeJourney.returnDropoffLocation.address}</p>
                </div>
              </div>

              {/* Pickup PIN Verification Card for PARTNER_ARRIVED */}
              {activeJourney.currentState === 'PARTNER_ARRIVED' ? (
                <div className="p-5 rounded-2xl border-2 border-indigo-400 bg-indigo-50/90 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-2xs shrink-0 mt-0.5">
                      <Key className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 block">
                        Mandatory Safety Protocol:
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        Verify Patient 4-Digit Pickup PIN
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        To confirm patient identity and ensure correct dispatch before departure, ask the patient for their 4-digit verification PIN displayed on their screen.
                      </p>

                      <form onSubmit={handleVerifyPin} className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={4}
                            autoComplete="one-time-code"
                            value={pickupPinInput}
                            onChange={(e) => {
                              setPickupPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                              if (pinError) setPinError(null);
                            }}
                            placeholder="Enter 4-digit PIN"
                            className="w-full px-4 py-2.5 rounded-xl border border-indigo-300 bg-white font-mono text-base font-bold tracking-widest text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                            disabled={isActionLoading}
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isActionLoading || pickupPinInput.trim().length !== 4}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          {isActionLoading ? 'Verifying PIN...' : 'Verify PIN & Confirm Pickup'}
                        </button>
                      </form>

                      {pinError && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>{pinError}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : nextAction ? (
                <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block mb-1">
                    Next Required Operational Milestone:
                  </span>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-bold text-slate-900 block">
                        {nextAction.label}
                      </span>
                      <span className="text-xs text-slate-600 block mt-0.5">
                        {nextAction.description}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isActionLoading}
                      onClick={() => handleAdvanceMilestone(nextAction.target)}
                      className={`px-5 py-2.5 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer shrink-0 disabled:opacity-50 ${nextAction.color}`}
                    >
                      <ArrowRight className="w-4 h-4" />
                      {nextAction.label}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Emergency SOS Button for Partner */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Encountered road delay, medical distress, or accident?
                </span>
                <button
                  type="button"
                  onClick={() => setIsSosOpen(true)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Trigger Emergency SOS
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Timeline */}
          <div>
            <JourneyTimeline currentState={activeJourney.currentState} />
          </div>
        </div>
      )}

      {/* Profile & Vehicle Card */}
      {partnerProfile && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Car className="w-4 h-4 text-indigo-600" />
            Registered Vehicle & Accommodations
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Vehicle</span>
              <p className="font-semibold text-slate-900 mt-1">
                {partnerProfile.vehicle?.make || 'Standard'} {partnerProfile.vehicle?.model || 'Vehicle'} ({partnerProfile.vehicle?.year || 2024})
              </p>
              <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                Plate: {partnerProfile.vehicle?.licensePlate || 'N/A'} • Color: {partnerProfile.vehicle?.color || 'White'}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Accessibility Specs</span>
              <p className="text-slate-700 mt-1">
                {partnerProfile.vehicle?.isWheelchairAccessible ? '✓ Wheelchair Accessible' : 'Standard Ingress'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {partnerProfile.vehicle?.accommodationsDescription || 'Assisted passenger seating'}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Service History</span>
              <p className="font-semibold text-slate-900 mt-1">
                {partnerProfile.totalJourneysCompleted} Completed Round Trips
              </p>
              <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                Verification: {partnerProfile.verificationStatus}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Compliance & Document Tracking Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              Care Partner Compliance & Document Records
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Authoritative tracking of mandatory driving licence, vehicle insurance, and commercial fitness certificate.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {complianceSummary && (
              <span
                className={`px-2.5 py-1 text-xs font-bold rounded-full border ${
                  complianceSummary.overallStatus === 'COMPLIANT'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : complianceSummary.overallStatus === 'NON_COMPLIANT'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {complianceSummary.overallStatus === 'COMPLIANT'
                  ? '✓ Fully Compliant'
                  : complianceSummary.overallStatus === 'NON_COMPLIANT'
                  ? '⚠ Non-Compliant'
                  : '⏳ Pending Review'}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setDocFormError(null);
                setShowDocUploadModal(true);
              }}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 border border-indigo-200 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Submit Document
            </button>
          </div>
        </div>

        {/* Warning if expired mandatory documents */}
        {complianceSummary && complianceSummary.expiredDocumentTypes.length > 0 && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Mandatory Documents Expired</p>
              <p className="text-red-600 mt-0.5">
                The following document(s) have passed their validity period: {complianceSummary.expiredDocumentTypes.join(', ')}.
                Per safety compliance regulations, new journey dispatches cannot be accepted until valid renewal records are submitted.
              </p>
            </div>
          </div>
        )}

        {/* Document Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {[
            {
              type: 'DRIVING_LICENCE' as const,
              title: 'Driving Licence',
              desc: 'State transport commercial passenger endorsement',
            },
            {
              type: 'VEHICLE_INSURANCE' as const,
              title: 'Vehicle Insurance',
              desc: 'Comprehensive commercial passenger vehicle policy',
            },
            {
              type: 'COMMERCIAL_FITNESS_CERTIFICATE' as const,
              title: 'Fitness Certificate (FC)',
              desc: 'Regional Transport Office annual fitness inspection',
            },
          ].map((item) => {
            const doc = complianceSummary?.documents.find((d) => d.type === item.type);
            const isMissing = !doc;
            const isExpired = doc?.status === 'EXPIRED';

            return (
              <div
                key={item.type}
                className={`p-4 rounded-xl border ${
                  isExpired
                    ? 'bg-red-50/50 border-red-200'
                    : isMissing
                    ? 'bg-slate-50 border-dashed border-slate-300'
                    : doc.status === 'VERIFIED'
                    ? 'bg-emerald-50/30 border-emerald-200'
                    : 'bg-amber-50/30 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900">{item.title}</span>
                  {doc ? (
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                        doc.status === 'VERIFIED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : doc.status === 'EXPIRED'
                          ? 'bg-red-100 text-red-800'
                          : doc.status === 'REJECTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {doc.status}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-200 text-slate-600 rounded-full">
                      Not Uploaded
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 mb-2">{item.desc}</p>

                {doc ? (
                  <div className="space-y-1 text-[11px] pt-2 border-t border-slate-200/60">
                    <p className="font-mono text-slate-700">
                      Ref: <span className="font-semibold">{doc.documentNumber}</span>
                    </p>
                    <p className={isExpired ? 'text-red-700 font-semibold' : 'text-slate-600'}>
                      Valid until: {doc.expiryDate} {isExpired ? '(EXPIRED)' : ''}
                    </p>
                    {doc.issueDate && (
                      <p className="text-slate-500 text-[10px]">Issued: {doc.issueDate}</p>
                    )}
                    {doc.rejectionReason && (
                      <p className="text-red-600 text-[10px] font-medium mt-1">
                        Reason: {doc.rejectionReason}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDocFormType(item.type);
                      setDocFormError(null);
                      setShowDocUploadModal(true);
                    }}
                    className="mt-2 text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    Submit record now
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Document Submission Modal */}
      {showDocUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" />
              Submit Compliance Document
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter official document reference details for operational review and verification.
            </p>

            {docFormError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
                {docFormError}
              </div>
            )}

            <form onSubmit={handleSubmitDocument} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Category</label>
                <select
                  value={docFormType}
                  onChange={(e) => setDocFormType(e.target.value as ComplianceDocumentType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white"
                >
                  <option value="DRIVING_LICENCE">Driving Licence (Commercial)</option>
                  <option value="VEHICLE_INSURANCE">Vehicle Insurance Policy</option>
                  <option value="COMMERCIAL_FITNESS_CERTIFICATE">Commercial Fitness Certificate</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Number / Reference</label>
                <input
                  type="text"
                  placeholder="e.g. KA-04-2023-0091823"
                  value={docFormNumber}
                  onChange={(e) => setDocFormNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Issue Date (Optional)</label>
                  <input
                    type="date"
                    value={docFormIssue}
                    onChange={(e) => setDocFormIssue(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={docFormExpiry}
                    onChange={(e) => setDocFormExpiry(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDocUploadModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={docFormSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  {docFormSubmitting ? 'Submitting...' : 'Submit for Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SOS Modal */}
      <EmergencyModal
        isOpen={isSosOpen}
        onClose={() => setIsSosOpen(false)}
        onConfirmSos={handleConfirmSos}
        hospitalPhone={activeJourney?.hospitalDestination.emergencyContactPhone}
      />
    </div>
  );
};
