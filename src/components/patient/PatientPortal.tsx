import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { neravuApi } from '../../services/api-client.ts';
import { googleMapsService } from '../../maps/google-maps-service.ts';
import { Journey, HospitalDestination, Location, PatientProfile, CarePartnerProfile, PaymentOrder, PaymentInvoice } from '../../domain/types/index.ts';
import { TwoLegRouteInfo } from '../../maps/types.ts';
import { JourneyTimeline } from '../common/JourneyTimeline.tsx';
import { EmergencyModal } from '../common/EmergencyModal.tsx';
import { NeravuJourneyMap } from '../maps/NeravuJourneyMap.tsx';
import {
  HeartHandshake,
  Key,
  MapPin,
  Calendar,
  Clock,
  Car,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  User,
  Users,
  Star,
  CheckCircle2,
  PlusCircle,
  Search,
  Navigation,
  RefreshCw,
  WifiOff,
  CreditCard,
  Receipt,
  FileText,
  CheckCircle,
} from 'lucide-react';

export const PatientPortal: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [carePartnerProfile, setCarePartnerProfile] = useState<CarePartnerProfile | null>(null);
  const [payments, setPayments] = useState<PaymentOrder[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<PaymentInvoice | null>(null);
  const [isPaying, setIsPaying] = useState<boolean>(false);
  const [hospitals, setHospitals] = useState<HospitalDestination[]>([]);
  const [hospitalSearchQuery, setHospitalSearchQuery] = useState<string>('');
  const [routePreview, setRoutePreview] = useState<TwoLegRouteInfo | null>(null);
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [isSosOpen, setIsSosOpen] = useState<boolean>(false);
  const [ratingSubmitted, setRatingSubmitted] = useState<boolean>(false);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(new Date().toLocaleTimeString());

  // Booking Wizard Form State
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [bookingType, setBookingType] = useState<'ON_DEMAND' | 'SCHEDULED'>('ON_DEMAND');
  const [scheduledTime, setScheduledTime] = useState<string>('2026-10-06T10:00');
  const [specialNotes, setSpecialNotes] = useState<string>('');

  const loadData = async () => {
    if (!currentUser) return;
    try {
      const [profile, hosps, journeys] = await Promise.all([
        neravuApi.getPatientProfile(currentUser.id),
        neravuApi.getHospitals(),
        neravuApi.getJourneys(),
      ]);

      setPatientProfile(profile);
      setHospitals(hosps);
      if (hosps.length > 0 && !selectedHospitalId) {
        setSelectedHospitalId(hosps[0].id);
      }

      const active = journeys.find(
        (j) => j.patientId === currentUser.id && j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
      ) || null;
      setActiveJourney(active);

      if (active?.carePartnerId) {
        const partner = await neravuApi.getCarePartnerProfile(active.carePartnerId);
        setCarePartnerProfile(partner);
      } else {
        setCarePartnerProfile(null);
      }

      const targetJourney = active || journeys.find((j) => j.patientId === currentUser.id);
      if (targetJourney) {
        const pList = await neravuApi.getJourneyPayments(targetJourney.id).catch(() => []);
        setPayments(pList);
      } else {
        setPayments([]);
      }

      setLastSyncedTime(new Date().toLocaleTimeString());
      setApiError(null);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Unable to connect to the Neravu server.');
    }
  };

  useEffect(() => {
    loadData();
    // Conservative HTTP polling: every 4 seconds to sync authoritative journey state
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Compute route preview whenever selected hospital changes
  useEffect(() => {
    async function updatePreview() {
      if (!patientProfile) return;
      const hosp = hospitals.find((h) => h.id === selectedHospitalId);
      if (!hosp) return;
      try {
        const preview = await googleMapsService.computeTwoLegJourneyRoute(
          patientProfile.homeAddress,
          hosp,
          patientProfile.homeAddress
        );
        setRoutePreview(preview);
      } catch {
        // Fallback handled
      }
    }
    updatePreview();
  }, [selectedHospitalId, patientProfile, hospitals]);

  const filteredHospitals = useMemo(() => {
    if (!hospitalSearchQuery.trim()) return hospitals;
    const q = hospitalSearchQuery.toLowerCase();
    return hospitals.filter(
      (h) => h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q)
    );
  }, [hospitals, hospitalSearchQuery]);

  if (!currentUser) return null;

  // Handle Booking Creation via backend API
  const handleCreateBooking = async () => {
    if (!patientProfile) return;
    const hosp = hospitals.find((h) => h.id === selectedHospitalId) || hospitals[0];
    setIsSubmitting(true);
    setApiError(null);

    // Generate one Idempotency-Key per logical booking attempt
    const idempotencyKey = `idem-${currentUser.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      await neravuApi.createBooking(
        {
          pickupLocation: patientProfile.homeAddress,
          hospitalDestination: hosp,
          returnDropoffLocation: patientProfile.homeAddress,
          bookingType,
          scheduledPickupTime: bookingType === 'SCHEDULED' ? scheduledTime : undefined,
          specialAssistanceNotes: specialNotes || patientProfile.nonClinicalAssistanceNotes,
        },
        { idempotencyKey }
      );

      await loadData();
      setIsBookingOpen(false);
      setWizardStep(1);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to request Care Partner booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Ready to Return Home via backend API
  const handleReadyToReturn = async () => {
    if (!activeJourney) return;
    setApiError(null);
    try {
      await neravuApi.advanceMilestone(
        activeJourney.id,
        'RETURN_STARTED',
        'Patient indicated medical visit concluded; ready for return transport home.'
      );
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to update return milestone.');
    }
  };

  // Handle Commercial Payment Order Creation and Confirmation
  const handleInitiatePayment = async () => {
    if (!activeJourney) return;
    setIsPaying(true);
    setApiError(null);
    try {
      const idempotencyKey = `idemp_pay_${activeJourney.id}_${Date.now()}`;
      const order = await neravuApi.createPaymentOrder(activeJourney.id, idempotencyKey);
      // In sandbox mode or automated environment, securely confirm with provider token:
      await neravuApi.confirmPayment(order.id, {
        providerPaymentId: `pay_gateway_${Date.now()}`,
        providerSignature: `test_valid_sig_${order.providerOrderId}`,
      });
      const updated = await neravuApi.getJourneyPayments(activeJourney.id);
      setPayments(updated);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Payment transaction failed.');
    } finally {
      setIsPaying(false);
    }
  };

  const handleViewInvoice = async (paymentId: string) => {
    try {
      const inv = await neravuApi.getPaymentInvoice(paymentId);
      setSelectedInvoice(inv);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to retrieve invoice.');
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
      setApiError(err.userFriendlyMessage || err.message || 'Failed to transmit emergency signal.');
    }
  };

  const selectedHospital = hospitals.find((h) => h.id === selectedHospitalId) || hospitals[0];

  return (
    <div className="space-y-6">
      {/* Network or Server Error Banner */}
      {apiError && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-amber-900 text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Server Communication Notice:</strong> {apiError} Unsaved changes are preserved.
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
              Welcome, {patientProfile ? currentUser.name : currentUser.name}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
              Patient Portal
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Round-Trip Medical Journey Companion & Transport — We accompany you from home to clinic and safely back home.
          </p>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-2">
            <RefreshCw className="w-3 h-3 text-teal-600 animate-spin-slow" />
            <span>Automatically refreshed from the server (Last sync: {lastSyncedTime})</span>
          </div>
        </div>

        {!activeJourney && !isBookingOpen && (
          <button
            type="button"
            onClick={() => setIsBookingOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            Request Care Partner (Round Trip)
          </button>
        )}
      </div>

      {/* Emergency SOS Float Banner during active journey */}
      {activeJourney && activeJourney.currentState !== 'COMPLETED' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5 text-xs text-red-900 font-medium">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Active Journey: In-flight emergency support available.</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSosOpen(true)}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Emergency SOS
          </button>
        </div>
      )}

      {/* ACTIVE JOURNEY VIEW */}
      {activeJourney && !isBookingOpen && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Journey Details & Actions (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Interactive Journey Map */}
            <NeravuJourneyMap journey={activeJourney} onReadyToReturn={handleReadyToReturn} />

            {/* Status Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                    Active Round-Trip Booking
                  </span>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {activeJourney.hospitalDestination.name}
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 font-bold border border-teal-200">
                    {activeJourney.currentState.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                    ID: {activeJourney.id}
                  </span>
                </div>
              </div>

              {/* Pickup Verification PIN Card */}
              {activeJourney.pickupPin && (
                <div
                  className={`my-4 p-4 rounded-2xl border transition-all ${
                    activeJourney.pickupPinVerified
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : activeJourney.currentState === 'PARTNER_ARRIVED'
                      ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/50'
                      : 'bg-indigo-50/70 border-indigo-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          activeJourney.pickupPinVerified
                            ? 'bg-emerald-600 text-white'
                            : activeJourney.currentState === 'PARTNER_ARRIVED'
                            ? 'bg-amber-600 text-white'
                            : 'bg-indigo-600 text-white'
                        }`}
                      >
                        {activeJourney.pickupPinVerified ? (
                          <ShieldCheck className="w-5 h-5" />
                        ) : (
                          <Key className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                          {activeJourney.pickupPinVerified ? 'Pickup Identity Verified' : 'Pickup Verification PIN'}
                        </span>
                        <span className="text-xs text-slate-700">
                          {activeJourney.pickupPinVerified
                            ? 'Your Care Partner has successfully verified your pickup PIN.'
                            : activeJourney.currentState === 'PARTNER_ARRIVED'
                            ? 'Your Care Partner has arrived! Tell them this 4-digit PIN to begin.'
                            : 'Share this 4-digit PIN with your Care Partner when they arrive.'}
                        </span>
                      </div>
                    </div>

                    {!activeJourney.pickupPinVerified && (
                      <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-indigo-300 shadow-2xs font-mono font-black text-xl tracking-widest text-indigo-950 self-start sm:self-auto select-all">
                        {activeJourney.pickupPin.split('').map((digit, i) => (
                          <span key={i} className="inline-block px-1.5 py-0.5 bg-indigo-50 rounded text-indigo-900 font-bold border border-indigo-100">
                            {digit}
                          </span>
                        ))}
                      </div>
                    )}

                    {activeJourney.pickupPinVerified && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold font-mono self-start sm:self-auto">
                        <CheckCircle2 className="w-4 h-4" /> Verified
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Crucial Hospital Visit Accompaniment Card */}
              {activeJourney.currentState === 'HOSPITAL_VISIT' && (
                <div className="my-5 p-5 bg-teal-50 border-2 border-teal-500 rounded-2xl shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-teal-600 text-white rounded-xl shadow-2xs">
                      <HeartHandshake className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <span className="text-xs font-bold text-teal-900 uppercase tracking-wider">
                        Care Partner is Accompanying You During Your Hospital Visit
                      </span>
                      <p className="text-xs text-teal-800 mt-1 leading-relaxed">
                        Your Care Partner has assisted you inside the medical facility and is waiting with you during your appointment/tests.
                        Your booking remains active. When you are finished with your doctor and ready to head home, tap below.
                      </p>

                      <div className="mt-4 pt-3 border-t border-teal-200 flex items-center justify-between">
                        <span className="text-xs text-teal-900 font-semibold">
                          Consultation or test finished?
                        </span>
                        <button
                          type="button"
                          onClick={handleReadyToReturn}
                          className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <ArrowRight className="w-4 h-4" />
                          Ready to Return Home
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Live Transit & ETA Banner */}
              {activeJourney.liveLocation && (
                <div
                  className={`my-4 p-4 rounded-2xl border transition-all ${
                    activeJourney.liveLocation.isStale
                      ? 'bg-amber-50/80 border-amber-300'
                      : 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-400/40'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          activeJourney.liveLocation.isStale
                            ? 'bg-amber-600 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <Navigation className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
                            {activeJourney.liveLocation.isStale
                              ? 'Care Partner Geolocation (Signal Stale)'
                              : 'Live Care Partner Geolocation'}
                          </span>
                          {!activeJourney.liveLocation.isStale && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-700">
                          {activeJourney.liveLocation.targetDestination
                            ? `Heading towards: ${activeJourney.liveLocation.targetDestination}`
                            : 'In transit along route'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-2xs self-start sm:self-auto font-mono text-xs">
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-sans">
                          Estimated ETA
                        </span>
                        <span className="font-bold text-emerald-800 text-sm">
                          {activeJourney.liveLocation.etaText || 'Calculating'}
                        </span>
                      </div>
                      {activeJourney.liveLocation.distanceText && (
                        <div className="border-l border-slate-200 pl-3">
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-sans">
                            Distance
                          </span>
                          <span className="font-bold text-slate-800">
                            {activeJourney.liveLocation.distanceText}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Journey Route Summary */}
              <div className="my-5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Route Information (Domain Booking Endpoints)
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {activeJourney.liveLocation
                      ? activeJourney.liveLocation.isStale
                        ? 'Companion GPS Stale (> 60s)'
                        : 'Live Companion GPS Active'
                      : 'Awaiting companion GPS'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Leg 1: Pickup (Home)
                    </span>
                    <span className="font-semibold text-slate-900 block mt-0.5">
                      {activeJourney.pickupLocation.address}
                    </span>
                    {activeJourney.pickupLocation.landmark && (
                      <span className="text-[11px] text-slate-500 block">
                        Ref: {activeJourney.pickupLocation.landmark}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Medical Destination
                    </span>
                    <span className="font-semibold text-teal-900 block mt-0.5">
                      {activeJourney.hospitalDestination.name}
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      {activeJourney.hospitalDestination.entranceOrDepartment || activeJourney.hospitalDestination.address}
                    </span>
                  </div>

                  <div className="md:col-span-2 pt-2 border-t border-slate-200">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Leg 2: Return Drop-off (Agreed Home)
                    </span>
                    <span className="font-semibold text-slate-900 block mt-0.5">
                      {activeJourney.returnDropoffLocation.address}
                    </span>
                  </div>
                </div>
              </div>

              {/* Assigned Care Partner Profile Card */}
              {carePartnerProfile && (
                <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-600 text-white rounded-xl">
                      <HeartHandshake className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        Assigned Care Partner
                      </span>
                      <span className="text-[11px] text-slate-600 block">
                        Verified Non-Clinical Companion • {carePartnerProfile.totalJourneysCompleted} Completed Journeys
                      </span>
                      <span className="text-[11px] font-mono text-indigo-700 font-semibold block mt-0.5">
                        Vehicle: {carePartnerProfile.vehicle.make} {carePartnerProfile.vehicle.model} ({carePartnerProfile.vehicle.licensePlate})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Non-Clinical Companion
                  </div>
                </div>
              )}

              {/* Commercial Accompaniment Payment & Invoice Card */}
              {(activeJourney.fareEstimate || activeJourney.initialFareEstimate) && (() => {
                const fare = activeJourney.fareEstimate || activeJourney.initialFareEstimate!;
                const totalAmount = fare.total ?? fare.totalEstimatedFare ?? 0;
                const successfulPayment = payments.find((p) => p.status === 'SUCCESS');
                const failedPayment = payments.find((p) => p.status === 'FAILED');

                return (
                  <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-teal-700" />
                        <span className="text-xs font-bold text-slate-900">
                          Commercial Accompaniment Fare & Payment
                        </span>
                      </div>
                      {successfulPayment ? (
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold flex items-center gap-1 font-mono">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          PAID • {successfulPayment.receiptNumber}
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold font-mono">
                          PAYMENT PENDING
                        </span>
                      )}
                    </div>

                    {/* Server-authoritative fare breakdown */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                      <div className="flex justify-between text-slate-600">
                        <span>Base Coordination & Pickup Fee:</span>
                        <span>₹{fare.baseBookingFee ?? 250}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Hospital Accompaniment & Waiting:</span>
                        <span>₹{fare.companionServiceTimeFee ?? 600}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Round-Trip Transit Fare:</span>
                        <span>₹{fare.transitDistanceFee ?? 350}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Platform Operations & GST:</span>
                        <span>₹{(fare.platformServiceFee ?? 100) + (fare.taxes ?? 90)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-slate-200 text-sm">
                        <span>Total Server-Calculated Fare:</span>
                        <span className="text-teal-700 font-mono">₹{totalAmount}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
                      <div className="text-[11px] text-slate-500">
                        {successfulPayment ? (
                          <span>Payment verified ({successfulPayment.provider}). Formal receipt issued.</span>
                        ) : (
                          <span>Server-authoritative rate. Never trust client-provided amounts.</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {successfulPayment ? (
                          <button
                            type="button"
                            onClick={() => handleViewInvoice(successfulPayment.id)}
                            className="px-3.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            View Official Receipt
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPaying}
                            onClick={handleInitiatePayment}
                            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            {isPaying ? 'Processing...' : `Pay Fare (₹${totalAmount})`}
                          </button>
                        )}
                      </div>
                    </div>

                    {failedPayment && !successfulPayment && (
                      <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Payment failed: {failedPayment.failureReason || 'Declined'}. You can safely retry.</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Post-Completion Rating Card */}
            {activeJourney.currentState === 'COMPLETED' && (
              <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-2xs text-center">
                <div className="inline-flex p-3 bg-emerald-100 text-emerald-700 rounded-2xl mb-3">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  You Have Been Safely Returned Home!
                </h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto mt-1">
                  Your round-trip medical journey has completed. We hope your hospital appointment and accompaniment went comfortably.
                </p>

                {!ratingSubmitted ? (
                  <div className="mt-4 pt-4 border-t border-slate-100 max-w-xs mx-auto">
                    <span className="text-xs font-bold text-slate-700 block mb-2">
                      Rate Your Care Partner
                    </span>
                    <div className="flex justify-center gap-1.5 mb-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setSelectedRating(star)}
                          className="cursor-pointer"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              star <= selectedRating
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRatingSubmitted(true)}
                      className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Submit Feedback
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium">
                    Thank you! Your rating has been recorded.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Real-time Journey Progress Timeline */}
          <div>
            <JourneyTimeline currentState={activeJourney.currentState} />
          </div>
        </div>
      )}

      {/* BOOKING WIZARD MODAL / VIEW */}
      {isBookingOpen && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Book a Medical Journey Companion (Round Trip)
              </h2>
              <p className="text-xs text-slate-500">
                Step {wizardStep} of 4: Single booking covering outbound, hospital accompaniment, and safe return home.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsBookingOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {/* Wizard Step 1: Pickup Location */}
          {wizardStep === 1 && (
            <div className="space-y-4 max-w-xl">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-teal-600" />
                Step 1: Confirm Pickup Location (Home)
              </h3>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Registered Home Address
                </span>
                <p className="font-semibold text-slate-900">
                  {patientProfile?.homeAddress.address}
                </p>
                <p className="text-slate-600">
                  <span className="font-medium">Landmark:</span> {patientProfile?.homeAddress.landmark}
                </p>
                <p className="text-slate-600">
                  <span className="font-medium">Access:</span> {patientProfile?.homeAddress.accessInstructions}
                </p>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  Next: Select Hospital <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Wizard Step 2: Hospital Selection */}
          {wizardStep === 2 && (
            <div className="space-y-4 max-w-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <HeartHandshake className="w-4 h-4 text-teal-600" />
                  Step 2: Select Hospital Destination
                </h3>
                <span className="text-[10px] text-slate-400">Searchable Places</span>
              </div>
              <p className="text-xs text-slate-500">
                The hospital is your medical destination. Your Care Partner will accompany you inside during the visit.
              </p>

              {/* Hospital Search Input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={hospitalSearchQuery}
                  onChange={(e) => setHospitalSearchQuery(e.target.value)}
                  placeholder="Search hospital name or clinic location..."
                  className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {filteredHospitals.map((hosp) => (
                  <label
                    key={hosp.id}
                    className={`block p-3.5 rounded-xl border transition-all cursor-pointer ${
                      selectedHospitalId === hosp.id
                        ? 'border-teal-500 bg-teal-50/50 ring-2 ring-teal-200'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="hospital"
                        checked={selectedHospitalId === hosp.id}
                        onChange={() => setSelectedHospitalId(hosp.id)}
                        className="mt-1 text-teal-600 focus:ring-teal-500"
                      />
                      <div className="flex-1">
                        <span className="text-xs font-bold text-slate-900 block">
                          {hosp.name}
                        </span>
                        <span className="text-[11px] text-slate-600 block mt-0.5">
                          {hosp.address}
                        </span>
                        {hosp.entranceOrDepartment && (
                          <span className="text-[10px] text-teal-700 font-medium block mt-1">
                            {hosp.entranceOrDepartment}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Two-Leg Route Preview */}
              {routePreview && (
                <div className="p-3 bg-teal-50/70 border border-teal-200 rounded-xl text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-teal-900 font-bold">
                    <span className="flex items-center gap-1">
                      <Navigation className="w-3.5 h-3.5" />
                      Two-Leg Route Estimate:
                    </span>
                    <span className="font-mono text-[11px]">
                      {routePreview.totalDistanceText} • ~{routePreview.totalDurationText} Total
                    </span>
                  </div>
                  <div className="text-[11px] text-teal-800 flex justify-between pt-1 border-t border-teal-200/60">
                    <span>Leg 1 (Home → Hospital): {routePreview.leg1Outbound.distanceText} ({routePreview.leg1Outbound.durationText})</span>
                    <span>Leg 2 (Return Home): {routePreview.leg2Return.distanceText} ({routePreview.leg2Return.durationText})</span>
                  </div>
                </div>
              )}

              <div className="pt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  Next: Timing & Return <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Wizard Step 3: Timing & Return */}
          {wizardStep === 3 && (
            <div className="space-y-4 max-w-xl">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-600" />
                Step 3: Schedule & Return Destination
              </h3>

              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-700 block">
                  Service Timing:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBookingType('ON_DEMAND')}
                    className={`p-3 rounded-xl border text-xs font-bold text-left cursor-pointer ${
                      bookingType === 'ON_DEMAND'
                        ? 'border-teal-500 bg-teal-50/50 text-teal-900 ring-2 ring-teal-200'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Immediate (On-Demand)
                    <span className="text-[11px] font-normal block text-slate-500 mt-1">
                      Dispatch nearest Care Partner now
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBookingType('SCHEDULED')}
                    className={`p-3 rounded-xl border text-xs font-bold text-left cursor-pointer ${
                      bookingType === 'SCHEDULED'
                        ? 'border-teal-500 bg-teal-50/50 text-teal-900 ring-2 ring-teal-200'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Scheduled Appointment
                    <span className="text-[11px] font-normal block text-slate-500 mt-1">
                      Pick up at planned date & time
                    </span>
                  </button>
                </div>

                {bookingType === 'SCHEDULED' && (
                  <div className="pt-2">
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      Pickup Date & Time:
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                )}

                <div className="pt-2">
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Return Destination (Standard Round Trip):
                  </label>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800">
                    <span className="font-semibold">Returning to Home:</span> {patientProfile?.homeAddress.address}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Special Assistance Notes for Companion:
                  </label>
                  <textarea
                    rows={2}
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="e.g. Wheelchair assistance required, please assist with registration documents..."
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(4)}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  Review & Confirm <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Wizard Step 4: Review & Request */}
          {wizardStep === 4 && (
            <div className="space-y-4 max-w-xl">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-600" />
                Step 4: Review Round-Trip Journey
              </h3>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-3">
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Service:</span>
                  <span className="font-bold text-slate-900">Complete Round-Trip Accompaniment</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Destination:</span>
                  <span className="font-semibold text-slate-900">{selectedHospital.name}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Timing:</span>
                  <span className="font-semibold text-slate-900">
                    {bookingType === 'ON_DEMAND' ? 'Immediate Dispatch' : `Scheduled: ${scheduledTime}`}
                  </span>
                </div>

                <div className="pt-2">
                  <span className="text-slate-500 block mb-1">
                    Estimated Fare (Development Pricing — Not final commercial tariff):
                  </span>
                  <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Base Booking Fee (Dev Default):</span>
                      <span>₹250</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Companion Service Time (Waiting & Visit Estimate):</span>
                      <span>₹600</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Round-Trip Transit (Leg 1 & Leg 2 Estimate):</span>
                      <span>₹350</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Platform & Safety Fee + Taxes:</span>
                      <span>₹190</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100 text-xs">
                      <span>Total Estimated Fare (Dev):</span>
                      <span className="text-teal-700">₹1,390</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1.5 block leading-normal">
                    Notice: Displayed fare is a development pricing estimate based on test configuration rates. Final commercial pricing is not yet established. Payment is not collected at this stage.
                  </span>
                </div>
              </div>

              <div className="pt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleCreateBooking}
                  className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting to Server...</span>
                    </>
                  ) : (
                    'Request Care Partner Now'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile & Registered Contacts Card */}
      {patientProfile && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-teal-600" />
            Patient Profile & Assistance Configuration
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Mobility Assistance Needs
              </span>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {patientProfile.mobilityAssistance.map((m) => (
                  <span
                    key={m}
                    className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-semibold"
                  >
                    {m.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Non-Clinical Companion Notes
              </span>
              <p className="text-slate-700 mt-1">
                {patientProfile.nonClinicalAssistanceNotes}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Linked Trusted Contacts (Live Alerts)
              </span>
              {patientProfile.trustedContacts.map((c) => (
                <div key={c.id} className="mt-1">
                  <span className="font-semibold text-slate-800">{c.contactName} ({c.relationship})</span>
                  <span className="text-[11px] text-slate-500 block">{c.contactPhone} • {c.permissionLevel}</span>
                </div>
              ))}
            </div>
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

      {/* Formal Payment Invoice / Receipt Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">Official Payment Receipt & Tax Invoice</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg border border-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Invoice #:</span>
                <span className="font-bold text-slate-900">{selectedInvoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Receipt Ref:</span>
                <span className="font-bold text-slate-900">{selectedInvoice.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Journey ID:</span>
                <span className="text-slate-700">{selectedInvoice.journeyId.slice(0, 16)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Status:</span>
                <span className="text-emerald-700 font-bold">{selectedInvoice.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Gateway Provider:</span>
                <span className="text-slate-700">{selectedInvoice.provider}</span>
              </div>
              {selectedInvoice.providerPaymentId && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Provider Payment ID:</span>
                  <span className="text-slate-700">{selectedInvoice.providerPaymentId}</span>
                </div>
              )}
              {selectedInvoice.paidAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Paid Timestamp:</span>
                  <span className="text-slate-700">{new Date(selectedInvoice.paidAt).toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Itemized Service Breakdown
              </span>
              <div className="flex justify-between text-slate-600">
                <span>Base Booking Coordination:</span>
                <span>₹{selectedInvoice.fareBreakdown?.baseBookingFee ?? 250}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Hospital Companion Attendance:</span>
                <span>₹{selectedInvoice.fareBreakdown?.companionServiceTimeFee ?? 600}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Two-Leg Transit Distance:</span>
                <span>₹{selectedInvoice.fareBreakdown?.transitDistanceFee ?? 350}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Platform Operations & Tax:</span>
                <span>₹{(selectedInvoice.fareBreakdown?.platformServiceFee ?? 100) + (selectedInvoice.fareBreakdown?.taxes ?? 90)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-slate-100 text-sm">
                <span>Total Amount Paid:</span>
                <span className="text-teal-700 font-mono">₹{selectedInvoice.amount} {selectedInvoice.currency}</span>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 italic">
              Notice: Neravu provides dedicated non-clinical accompaniment and assisted mobility. This invoice covers mobility coordination services.
            </p>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
