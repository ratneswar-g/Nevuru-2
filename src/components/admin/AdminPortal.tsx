import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { neravuApi } from '../../services/api-client.ts';
import { Journey, CarePartnerProfile, PricingPolicy, EmergencyLogRecord, CarePartnerComplianceSummary, ComplianceDocument, PaymentOrder } from '../../domain/types/index.ts';
import { DEFAULT_PRICING_POLICY } from '../../domain/index.ts';
import { NeravuJourneyMap } from '../maps/NeravuJourneyMap.tsx';
import {
  ShieldAlert,
  Car,
  HeartHandshake,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  RefreshCw,
  Search,
  Phone,
  FileText,
  DollarSign,
  ShieldCheck,
  Tag,
  WifiOff,
  ChevronDown,
  ChevronUp,
  XCircle,
  CreditCard,
  Receipt,
} from 'lucide-react';

export const AdminPortal: React.FC = () => {
  const { currentUser } = useAuth();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [carePartners, setCarePartners] = useState<CarePartnerProfile[]>([]);
  const [complianceMap, setComplianceMap] = useState<Record<string, CarePartnerComplianceSummary>>({});
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('');
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [complianceNotice, setComplianceNotice] = useState<string | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [payments, setPayments] = useState<PaymentOrder[]>([]);
  const [resolutionNote, setResolutionNote] = useState<string>('Operational incident reviewed by Admin; companion and patient contacted; operational clearance given to resume journey.');
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy>({ ...DEFAULT_PRICING_POLICY });
  const [pricingForm, setPricingForm] = useState<PricingPolicy>({ ...DEFAULT_PRICING_POLICY });
  const [pricingSuccessMsg, setPricingSuccessMsg] = useState<string | null>(null);
  const [pricingErrorMsg, setPricingErrorMsg] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(new Date().toLocaleTimeString());

  const loadData = async () => {
    try {
      const [allJ, currentPolicy, complianceList, paymentList] = await Promise.all([
        neravuApi.getJourneys(),
        neravuApi.getPricingPolicy(),
        neravuApi.getAllCarePartnerCompliance().catch(() => [] as CarePartnerComplianceSummary[]),
        neravuApi.getAllPaymentsAdmin().catch(() => [] as PaymentOrder[]),
      ]);

      setJourneys(allJ);
      setPayments(paymentList);
      if (allJ.length > 0 && !selectedJourney) {
        setSelectedJourney(allJ[0]);
      } else if (selectedJourney) {
        const found = allJ.find((j) => j.id === selectedJourney.id);
        if (found) setSelectedJourney(found);
      }

      const cMap: Record<string, CarePartnerComplianceSummary> = {};
      for (const c of complianceList) {
        cMap[c.carePartnerId] = c;
      }
      setComplianceMap(cMap);

      const journeyPartnerIds = allJ.map((j) => j.carePartnerId).filter(Boolean) as string[];
      const compliancePartnerIds = complianceList.map((c) => c.carePartnerId);
      const allPartnerIds = Array.from(new Set([...journeyPartnerIds, ...compliancePartnerIds]));

      if (allPartnerIds.length > 0) {
        const loadedPartners = await Promise.all(
          allPartnerIds.map((id) => neravuApi.getCarePartnerProfile(id).catch(() => null))
        );
        setCarePartners(loadedPartners.filter((p): p is CarePartnerProfile => Boolean(p)));
      } else {
        setCarePartners([]);
      }

      setPricingPolicy(currentPolicy);
      if (!pricingForm) {
        setPricingForm(currentPolicy);
      }

      setLastSyncedTime(new Date().toLocaleTimeString());
      setApiError(null);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Unable to connect to the Neravu server.');
    }
  };

  const handleReviewComplianceDoc = async (
    partnerId: string,
    docId: string,
    status: 'VERIFIED' | 'REJECTED',
    rejectionReason?: string
  ) => {
    setReviewingDocId(docId);
    setComplianceNotice(null);
    try {
      const res = await neravuApi.reviewComplianceDocument(partnerId, docId, {
        status,
        rejectionReason,
      });
      setComplianceNotice(`Document successfully marked as ${status}. Overall status: ${res.summary.overallStatus}`);
      setRejectingDocId(null);
      setRejectionReasonInput('');
      await loadData();
      setTimeout(() => setComplianceNotice(null), 5000);
    } catch (err: any) {
      setComplianceNotice(err.userFriendlyMessage || err.message || 'Failed to review document.');
    } finally {
      setReviewingDocId(null);
    }
  };

  useEffect(() => {
    loadData();
    // Conservative HTTP polling: every 4 seconds to sync authoritative state across all journeys
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser]);

  if (!currentUser) return null;

  const activeEmergencies = journeys.filter((j) => j.currentState === 'EMERGENCY_ACTIVE');

  const handleResolveEmergency = async (journeyId: string) => {
    setIsResolving(true);
    setApiError(null);
    try {
      await neravuApi.resolveEmergency(journeyId, resolutionNote);
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Error resolving emergency incident.');
    } finally {
      setIsResolving(false);
    }
  };

  const handleSavePricingPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricingForm) return;
    setPricingSuccessMsg(null);
    setPricingErrorMsg(null);
    try {
      const updated = await neravuApi.updatePricingPolicy(pricingForm);
      setPricingPolicy(updated);
      setPricingSuccessMsg(`Pricing policy updated successfully to version: ${updated.version}`);
      setTimeout(() => setPricingSuccessMsg(null), 4000);
    } catch (err: any) {
      setPricingErrorMsg(err.userFriendlyMessage || err.message || 'Failed to update pricing policy.');
    }
  };

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
              Neravu Operations Desk
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
              Admin & Dispatch Control
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Development fleet oversight, hospital accompaniment monitoring, and incident emergency response. (Location shown from booking data)
          </p>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-2">
            <RefreshCw className="w-3 h-3 text-amber-600 animate-spin-slow" />
            <span>Automatically refreshed from the server (Last sync: {lastSyncedTime})</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">System Health</span>
            <span className="text-xs font-bold text-emerald-600 flex items-center justify-end gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              All Services Normal (Dev Mode)
            </span>
          </div>
        </div>
      </div>

      {/* Emergency Active Banner */}
      {activeEmergencies.length > 0 && (
        <div className="p-5 bg-red-100 border-2 border-red-500 rounded-2xl text-red-950 shadow-md">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">
                  CRITICAL: {activeEmergencies.length} Active Emergency Alert(s)
                </span>
                <p className="text-xs text-red-800 mt-0.5">
                  Journey ID: <strong className="font-mono">{activeEmergencies[0].id}</strong> triggered an in-flight emergency. Status snapshot preserved.
                </p>
                <div className="mt-2 text-xs font-mono bg-white/70 p-2 rounded border border-red-200">
                  Last State: {activeEmergencies[0].previousStateBeforeEmergency || 'IN_TRANSIT'} • Destination: {activeEmergencies[0].hospitalDestination.name}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 shrink-0">
              <input
                type="text"
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Operational resolution notes (non-clinical)..."
                className="text-xs p-1.5 bg-white border border-red-300 rounded block w-72"
              />
              <span className="text-[10px] text-red-800 block">
                Operational clearance only. Neravu is non-clinical; do not record medical diagnosis or treatment.
              </span>
              <button
                type="button"
                disabled={isResolving}
                onClick={() => handleResolveEmergency(activeEmergencies[0].id)}
                className="w-full px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                Resolve & Resume Journey
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Journeys Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table of Journeys (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <HeartHandshake className="w-4 h-4 text-teal-600" />
              Active & Recent Round-Trip Journeys (Development Status)
            </h2>
            <span className="text-xs text-slate-500 font-mono">
              Total: {journeys.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Journey ID</th>
                  <th className="p-3">Patient</th>
                  <th className="p-3">Care Partner</th>
                  <th className="p-3">Hospital Destination</th>
                  <th className="p-3">State</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {journeys.map((j) => {
                  const isSelected = selectedJourney?.id === j.id;
                  return (
                    <tr
                      key={j.id}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                        isSelected ? 'bg-teal-50/60' : ''
                      }`}
                      onClick={() => setSelectedJourney(j)}
                    >
                      <td className="p-3 font-mono text-slate-600 font-medium">
                        {j.id.substring(0, 16)}...
                      </td>
                      <td className="p-3 font-semibold text-slate-900">
                        {j.patientId ? `Patient (${j.patientId.slice(0, 12)}...)` : 'Patient'}
                      </td>
                      <td className="p-3 text-slate-600">
                        {j.carePartnerId ? `Care Partner (${j.carePartnerId.slice(0, 12)}...)` : <span className="text-amber-600 font-medium">Unassigned</span>}
                      </td>
                      <td className="p-3 text-teal-900 font-medium">
                        {j.hospitalDestination.name}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            j.currentState === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : j.currentState === 'EMERGENCY_ACTIVE'
                              ? 'bg-red-100 text-red-800 animate-pulse'
                              : j.currentState === 'HOSPITAL_VISIT'
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {j.currentState}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setSelectedJourney(j)}
                          className="text-[11px] text-teal-700 font-bold hover:underline"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Journey Audit Inspector (1 col) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-500" />
              Journey State Audit Log
            </h3>
            {selectedJourney && (
              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                {selectedJourney.id}
              </span>
            )}
          </div>

          {selectedJourney ? (
            <div className="space-y-3">
              <NeravuJourneyMap journey={selectedJourney} />

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Current Status</span>
                  <span className="text-[9px] text-slate-400 italic">Location shown from booking data</span>
                </div>
                <p className="font-bold text-teal-900">{selectedJourney.currentState}</p>
                <p className="text-[11px] text-slate-600">
                  Hospital: {selectedJourney.hospitalDestination.name}
                </p>
                <p className="text-[11px] text-slate-600">
                  Return Drop-Off: {selectedJourney.returnDropoffLocation.address}
                </p>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  Transition Audit Trail ({selectedJourney.stateHistory.length}):
                </span>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {selectedJourney.stateHistory.map((rec, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-slate-200 bg-white text-[11px] space-y-0.5"
                    >
                      <div className="flex items-center justify-between font-mono font-semibold text-slate-800">
                        <span>{rec.fromState} → {rec.toState}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(rec.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[10px]">{rec.note || 'Milestone executed'}</p>
                      <span className="text-[9px] text-slate-400 block">User: {rec.triggeredByUserId}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Select a journey from table to view audit log.</p>
          )}
        </div>
      </div>

      {/* Care Partner Fleet & Verification Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Car className="w-4 h-4 text-indigo-600" />
              Care Partner Fleet Status & Compliance Verification
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Review mandatory driving licence, vehicle insurance, and commercial fitness certificate records.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {carePartners.length} {carePartners.length === 1 ? 'Partner' : 'Partners'} Registered
          </span>
        </div>

        {complianceNotice && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 font-medium">
            {complianceNotice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 text-xs">
          {carePartners.map((cp) => {
            const compliance = complianceMap[cp.userId];
            const isExpanded = expandedPartnerId === cp.userId;

            return (
              <div key={cp.userId} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="font-bold text-slate-900 block text-sm">Care Partner</span>
                      <span className="text-[11px] font-mono text-slate-500">{cp.userId}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        cp.verificationStatus === 'VERIFIED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : cp.verificationStatus === 'REJECTED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      Partner: {cp.verificationStatus}
                    </span>

                    {compliance && (
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          compliance.overallStatus === 'COMPLIANT'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : compliance.overallStatus === 'NON_COMPLIANT'
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        Compliance: {compliance.overallStatus}
                      </span>
                    )}

                    <button
                      onClick={() => setExpandedPartnerId(isExpanded ? null : cp.userId)}
                      className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" /> Hide Documents
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" /> Review Documents
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">Vehicle:</span>{' '}
                    <span className="font-medium text-slate-800">{cp.vehicle?.make || 'Maruti Suzuki'} {cp.vehicle?.model || 'Ertiga'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">License Plate:</span>{' '}
                    <span className="font-mono font-medium text-slate-800">{cp.vehicle?.licensePlate || 'KA 03 DEMO 4821'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Wheelchair Ingress:</span>{' '}
                    <span className="font-medium text-emerald-700">✓ Accessible</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Duty Status:</span>{' '}
                    <span className="font-bold text-indigo-700">{cp.availabilityStatus}</span>
                  </div>
                </div>

                {/* Expanded Compliance Documents View */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                    <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      Mandatory Compliance Records Review
                    </h4>

                    {compliance && compliance.expiredDocumentTypes.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>
                          <strong>Expired Mandatory Documents:</strong> {compliance.expiredDocumentTypes.join(', ')}. Partner cannot accept new journey dispatches.
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { type: 'DRIVING_LICENCE' as const, label: 'Driving Licence (DL)' },
                        { type: 'VEHICLE_INSURANCE' as const, label: 'Vehicle Insurance' },
                        { type: 'COMMERCIAL_FITNESS_CERTIFICATE' as const, label: 'Commercial Fitness Certificate (FC)' },
                      ].map((item) => {
                        const doc = (compliance?.documents || cp.documents || []).find((d) => d.type === item.type);
                        const isExpired = doc?.status === 'EXPIRED';

                        return (
                          <div
                            key={item.type}
                            className={`p-3 rounded-lg border text-xs space-y-2 ${
                              !doc
                                ? 'bg-slate-100 border-slate-200 opacity-70'
                                : isExpired
                                ? 'bg-red-50 border-red-200'
                                : doc.status === 'VERIFIED'
                                ? 'bg-emerald-50/50 border-emerald-200'
                                : doc.status === 'REJECTED'
                                ? 'bg-red-50/50 border-red-200'
                                : 'bg-amber-50/50 border-amber-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800">{item.label}</span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  !doc
                                    ? 'bg-slate-200 text-slate-600'
                                    : isExpired
                                    ? 'bg-red-100 text-red-800'
                                    : doc.status === 'VERIFIED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : doc.status === 'REJECTED'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {!doc ? 'MISSING' : doc.status}
                              </span>
                            </div>

                            {doc ? (
                              <div className="space-y-1 text-[11px]">
                                <div>
                                  <span className="text-slate-500">Ref:</span>{' '}
                                  <span className="font-mono font-medium text-slate-800">{doc.documentNumber}</span>
                                </div>
                                {doc.issueDate && (
                                  <div>
                                    <span className="text-slate-500">Issued:</span>{' '}
                                    <span className="text-slate-700">{doc.issueDate}</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-slate-500">Expires:</span>{' '}
                                  <span className={`font-medium ${isExpired ? 'text-red-700 font-bold' : 'text-slate-700'}`}>
                                    {doc.expiryDate} {isExpired ? '(EXPIRED)' : ''}
                                  </span>
                                </div>
                                {doc.rejectionReason && (
                                  <div className="text-red-600 text-[10px] italic">
                                    Reason: {doc.rejectionReason}
                                  </div>
                                )}

                                {/* Admin Action Controls */}
                                <div className="pt-2 border-t border-slate-200 flex items-center gap-1.5">
                                  {rejectingDocId === doc.id ? (
                                    <div className="w-full space-y-1.5 pt-1">
                                      <input
                                        type="text"
                                        placeholder="Reason for rejection..."
                                        value={rejectionReasonInput}
                                        onChange={(e) => setRejectionReasonInput(e.target.value)}
                                        className="w-full p-1.5 text-xs bg-white border border-red-300 rounded"
                                      />
                                      <div className="flex gap-1 justify-end">
                                        <button
                                          onClick={() => {
                                            setRejectingDocId(null);
                                            setRejectionReasonInput('');
                                          }}
                                          className="px-2 py-0.5 text-[10px] text-slate-600 bg-slate-200 hover:bg-slate-300 rounded cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          disabled={reviewingDocId === doc.id}
                                          onClick={() =>
                                            handleReviewComplianceDoc(
                                              cp.userId,
                                              doc.id,
                                              'REJECTED',
                                              rejectionReasonInput.trim() || undefined
                                            )
                                          }
                                          className="px-2 py-0.5 text-[10px] text-white bg-red-600 hover:bg-red-700 rounded font-bold cursor-pointer"
                                        >
                                          Confirm Reject
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <button
                                        disabled={reviewingDocId === doc.id || doc.status === 'VERIFIED'}
                                        onClick={() => handleReviewComplianceDoc(cp.userId, doc.id, 'VERIFIED')}
                                        className={`flex-1 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
                                          doc.status === 'VERIFIED'
                                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                        }`}
                                      >
                                        {doc.status === 'VERIFIED' ? '✓ Verified' : 'Verify'}
                                      </button>
                                      <button
                                        disabled={reviewingDocId === doc.id}
                                        onClick={() => {
                                          setRejectingDocId(doc.id);
                                          setRejectionReasonInput('');
                                        }}
                                        className="py-1 px-2 text-[10px] font-bold text-red-700 bg-red-100 hover:bg-red-200 rounded cursor-pointer"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400 italic">No document submitted yet.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Commercial Mobility Payments & Gateway Transactions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-teal-600" />
              Commercial Mobility Payments & Gateway Transactions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Authoritative transaction ledger for booking accompaniment fares. Amount is strictly server-derived.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
              Total Volume: {payments.length}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold">
              Settled: ₹{payments.filter((p) => p.status === 'SUCCESS').reduce((sum, p) => sum + p.amount, 0)}
            </span>
          </div>
        </div>

        {/* Transactions Table */}
        {payments.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
            No commercial payment orders recorded yet. Initiate a booking accompaniment payment to generate transaction records.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Payment ID / Ref</th>
                  <th className="p-3">Receipt #</th>
                  <th className="p-3">Journey ID</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created / Paid At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 text-slate-900 font-bold">{p.id.slice(0, 16)}...</td>
                    <td className="p-3 text-slate-700">{p.receiptNumber}</td>
                    <td className="p-3 text-slate-500">{p.journeyId.slice(0, 14)}...</td>
                    <td className="p-3 text-teal-700 font-bold font-sans text-xs">₹{p.amount} {p.currency}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 border border-slate-200">
                        {p.provider}
                      </span>
                    </td>
                    <td className="p-3 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === 'SUCCESS'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.status === 'FAILED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 font-sans text-[11px]">
                      {p.paidAt ? new Date(p.paidAt).toLocaleString() : new Date(p.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Global Pricing Policy Configuration Management */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              Pricing Policy Configuration (Development Test Rates)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Provider-neutral domain fare structure for development testing. These values represent test configuration defaults and are NOT final commercial pricing.
            </p>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300">
            Dev Config: {pricingPolicy.version}
          </span>
        </div>

        {pricingSuccessMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
            {pricingSuccessMsg}
          </div>
        )}

        {pricingErrorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-medium">
            {pricingErrorMsg}
          </div>
        )}

        <form onSubmit={handleSavePricingPolicy} className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              Base Booking Fee (₹):
            </label>
            <input
              type="number"
              min={0}
              value={pricingForm.baseServiceFee}
              onChange={(e) => setPricingForm({ ...pricingForm, baseServiceFee: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Dispatch & care partner allocation</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              Transport Rate (₹ / km):
            </label>
            <input
              type="number"
              min={0}
              value={pricingForm.perDistanceRatePerKm}
              onChange={(e) => setPricingForm({ ...pricingForm, perDistanceRatePerKm: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Applied to complete round-trip distance</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              Accompaniment Rate (₹ / hr):
            </label>
            <input
              type="number"
              min={0}
              value={pricingForm.perAccompanimentRatePerHour}
              onChange={(e) => setPricingForm({ ...pricingForm, perAccompanimentRatePerHour: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Hospital waiting & accompaniment</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              Platform & Safety Fee (₹):
            </label>
            <input
              type="number"
              min={0}
              value={pricingForm.platformFee}
              onChange={(e) => setPricingForm({ ...pricingForm, platformFee: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Coordination desk and SOS safety</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              GST / Statutory Tax Rate (0.0 to 1.0):
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={pricingForm.taxRate}
              onChange={(e) => setPricingForm({ ...pricingForm, taxRate: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">e.g. 0.05 for 5% GST</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-bold text-slate-700 block mb-1">
              Minimum Fare Threshold (₹):
            </label>
            <input
              type="number"
              min={0}
              value={pricingForm.minimumFare}
              onChange={(e) => setPricingForm({ ...pricingForm, minimumFare: Number(e.target.value) })}
              className="w-full p-2 border border-slate-300 rounded-lg bg-white"
              required
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Floor price for complete round trip</span>
          </div>

          <div className="md:col-span-3 flex justify-between items-center pt-2">
            <span className="text-[11px] text-slate-500 italic">
              Note: Updating pricing policy creates a new version snapshot. Existing booked journeys preserve their original fare estimates.
            </span>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              Update Pricing Policy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
