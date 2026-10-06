import { Location } from './location.ts';
import { HospitalDestination } from './hospital.ts';
import { EmergencyCategory, EmergencyLogRecord } from '../emergency/types.ts';

export type JourneyState =
  | 'DRAFT'
  | 'REQUESTED'
  | 'MATCHING'
  | 'PARTNER_ASSIGNED'
  | 'PARTNER_EN_ROUTE'
  | 'PARTNER_ARRIVED'
  | 'PATIENT_PICKED_UP'
  | 'IN_TRANSIT_TO_HOSPITAL'
  | 'ARRIVED_AT_HOSPITAL'
  | 'HOSPITAL_VISIT'
  | 'RETURN_STARTED'
  | 'IN_TRANSIT_TO_HOME'
  | 'PATIENT_RETURNED_HOME'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PARTNER_CANCELLED'
  | 'EMERGENCY_ACTIVE'
  | 'INCIDENT_REPORTED'
  | 'ESCALATED';

export type BookingType = 'ON_DEMAND' | 'SCHEDULED';

export interface StateTransitionRecord {
  fromState: JourneyState;
  toState: JourneyState;
  timestamp: string;
  triggeredByUserId?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface FareComponent {
  name: string;
  amount: number;
  code?: string;
  description?: string;
}

export interface FareBreakdown {
  currency: string;
  total: number;
  totalEstimatedFare?: number;
  baseBookingFee: number;
  transitDistanceFee: number;
  companionServiceTimeFee: number;
  platformServiceFee: number;
  taxes: number;
  isEstimate: boolean;
  components?: FareComponent[];
  policyVersion?: string;
  calculatedAt?: string;
}

export interface Journey {
  id: string;
  patientId: string;
  carePartnerId?: string | null;
  pickupLocation: Location;
  hospitalDestination: HospitalDestination;
  returnDropoffLocation: Location;
  currentState: JourneyState;
  bookingType: BookingType;
  scheduledPickupTime?: string;
  isRoundTrip: boolean;
  stateHistory: StateTransitionRecord[];
  stateTimestamps?: Record<string, string>;
  fareEstimate?: FareBreakdown;
  initialFareEstimate?: FareBreakdown;
  emergencyLogs?: EmergencyLogRecord[];
  incidentReports?: any[];
  specialAssistanceNotes?: string;
  previousStateBeforeEmergency?: JourneyState;
  emergencyCategory?: EmergencyCategory;
  emergencyReason?: string;
  createdAt: string;
  updatedAt: string;
}
