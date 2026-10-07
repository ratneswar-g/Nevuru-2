import {
  Journey,
  Location,
  HospitalDestination,
  BookingType,
  FareBreakdown,
} from './types/index.ts';

export interface CreateJourneyInput {
  id?: string;
  patientId: string;
  pickupLocation: Location;
  hospitalDestination: HospitalDestination;
  /** Defaults to pickupLocation if not specified (standard round trip back home) */
  returnDropoffLocation?: Location;
  bookingType?: BookingType;
  scheduledPickupTime?: string;
  specialAssistanceNotes?: string;
  initialFareEstimate?: FareBreakdown;
  pickupPin?: string;
}

function generateSecurePickupPin(): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buf);
      return String(1000 + (buf[0] % 9000));
    }
  } catch {
    // Fallback
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function createRoundTripJourney(input: CreateJourneyInput): Journey {
  const now = new Date().toISOString();
  const id = input.id || `journey-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const pickupPin = input.pickupPin || generateSecurePickupPin();

  return {
    id,
    patientId: input.patientId,
    carePartnerId: null,
    pickupLocation: input.pickupLocation,
    hospitalDestination: input.hospitalDestination,
    // The agreed return drop-off destination is the patient's home/agreed location
    returnDropoffLocation: input.returnDropoffLocation || input.pickupLocation,
    currentState: 'DRAFT',
    bookingType: input.bookingType || 'ON_DEMAND',
    scheduledPickupTime: input.scheduledPickupTime,
    isRoundTrip: true,
    pickupPin,
    pickupPinVerified: false,
    pickupPinFailedAttempts: 0,
    pickupPinLockedUntil: null,
    stateHistory: [
      {
        fromState: 'DRAFT',
        toState: 'DRAFT',
        timestamp: now,
        triggeredByUserId: input.patientId,
        note: 'Journey created in DRAFT state.',
      },
    ],
    stateTimestamps: {
      DRAFT: now,
    },
    fareEstimate: input.initialFareEstimate,
    initialFareEstimate: input.initialFareEstimate,
    emergencyLogs: [],
    incidentReports: [],
    specialAssistanceNotes: input.specialAssistanceNotes,
    createdAt: now,
    updatedAt: now,
  };
}
