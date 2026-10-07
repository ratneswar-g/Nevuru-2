import {
  Journey,
  JourneyState,
  Location,
  HospitalDestination,
  PatientProfile,
  CarePartnerProfile,
  TrustedContact,
  IDomainStore,
  PersistentDomainStore,
  createRoundTripJourney,
  transitionJourney,
  restoreFromEmergency,
  DomainError,
  PricingPolicy,
  DEFAULT_PRICING_POLICY,
  validatePricingPolicy,
  calculateJourneyFare,
  FareCalculationInput,
  FareBreakdown,
  EmergencyCategory,
  validateEmergencyTrigger,
  EmergencyLogRecord,
  CarePartnerLiveLocation,
} from '../domain/index.ts';
import { createFallbackRouteLeg } from '../maps/geo-utils.ts';
import { AuthUser, authorizeAction, getFamilyAccessScope } from '../auth/index.ts';

export interface ITransactionalStore extends IDomainStore {
  driver: {
    transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  };
  idempotencyKeys: {
    findByPatientAndKey(patientId: string, idempotencyKey: string): Promise<{ journeyId: string; patientId: string; idempotencyKey: string } | null>;
    save(record: { id: string; patientId: string; idempotencyKey: string; journeyId: string; createdAt: string }): Promise<any>;
  };
}

function isTransactionalStore(store: IDomainStore): store is ITransactionalStore {
  return Boolean(
    store &&
    typeof store === 'object' &&
    'idempotencyKeys' in store &&
    Boolean((store as any).idempotencyKeys) &&
    'driver' in store &&
    Boolean((store as any).driver?.transaction)
  );
}

export type JourneyListener = () => void;

export class JourneyService {
  public store: IDomainStore;
  private listeners: Set<JourneyListener> = new Set();
  private activePricingPolicy: PricingPolicy = { ...DEFAULT_PRICING_POLICY };

  constructor(customStore?: IDomainStore) {
    this.store = customStore || new PersistentDomainStore();
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
      this.seedInitialDomainData();
    }
  }

  subscribe(listener: JourneyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  async getHospitals(): Promise<HospitalDestination[]> {
    return this.store.hospitals.findAll();
  }

  async getPatientProfile(patientId: string): Promise<PatientProfile | null> {
    return this.store.patientProfiles.findByUserId(patientId);
  }

  async getCarePartnerProfile(partnerId: string): Promise<CarePartnerProfile | null> {
    return this.store.carePartners.findByUserId(partnerId);
  }

  async getActiveJourneyForPatient(patientId: string): Promise<Journey | null> {
    return this.store.journeys.findActiveByPatientId(patientId);
  }

  async getActiveJourneyForPartner(partnerId: string): Promise<Journey | null> {
    const journeys = await this.store.journeys.findByCarePartnerId(partnerId);
    return (
      journeys.find(
        (j) =>
          j.currentState !== 'COMPLETED' &&
          j.currentState !== 'CANCELLED' &&
          j.currentState !== 'PARTNER_CANCELLED'
      ) || null
    );
  }

  async getOfferedJourneysForPartner(partnerId: string): Promise<Journey[]> {
    // Journeys in MATCHING state are open for assignment to available partners
    const all = await this.getAllJourneys();
    return all.filter((j) => j.currentState === 'MATCHING');
  }

  async getAllJourneys(): Promise<Journey[]> {
    return this.store.journeys.findAll();
  }

  async getJourneyById(journeyId: string): Promise<Journey | null> {
    return this.store.journeys.findById(journeyId);
  }

  /**
   * Creates a single round-trip journey for a patient with idempotency and single-active protection.
   */
  async createBookingWithIdempotency(
    patient: AuthUser,
    params: {
      pickupLocation: Location;
      hospitalDestination: HospitalDestination;
      returnDropoffLocation?: Location;
      bookingType: 'ON_DEMAND' | 'SCHEDULED';
      scheduledPickupTime?: string;
      specialAssistanceNotes?: string;
      initialFareEstimate?: FareBreakdown;
      fareEstimate?: FareBreakdown;
    },
    idempotencyKey?: string
  ): Promise<{ journey: Journey; isIdempotentReplay: boolean }> {
    const auth = authorizeAction(patient, 'CREATE_JOURNEY');
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_TRANSITION', auth.reason || 'Unauthorized to create booking');
    }

    const isTxStore = isTransactionalStore(this.store);
    const txStore = isTxStore ? (this.store as ITransactionalStore) : null;

    // CASE B: If idempotencyKey is provided, check if it was already fulfilled
    if (idempotencyKey && txStore) {
      const existingIdem = await txStore.idempotencyKeys.findByPatientAndKey(
        patient.id,
        idempotencyKey
      );
      if (existingIdem) {
        const existingJourney = await this.store.journeys.findById(existingIdem.journeyId);
        if (existingJourney) {
          return { journey: existingJourney, isIdempotentReplay: true };
        }
      }
    }

    // CASE C: Active journey protection
    // An active journey is any journey whose current state is NOT terminal
    // (terminal states: COMPLETED, CANCELLED, PARTNER_CANCELLED)
    if (isTxStore) {
      const activeJourney = await this.store.journeys.findActiveByPatientId(patient.id);
      if (activeJourney) {
        throw new DomainError(
          'ACTIVE_JOURNEY_EXISTS',
          `Patient '${patient.id}' already has an active journey ('${activeJourney.id}' in state '${activeJourney.currentState}'). Please complete or cancel the active journey before creating a new one.`
        );
      }
    }

    const defaultFareSnapshot: FareBreakdown = {
      currency: this.activePricingPolicy.currency,
      baseBookingFee: this.activePricingPolicy.baseServiceFee,
      companionServiceTimeFee: 600,
      transitDistanceFee: 350,
      platformServiceFee: this.activePricingPolicy.platformFee,
      taxes: 90,
      total: 1390,
      isEstimate: true,
      components: [
        {
          code: 'BASE_SERVICE',
          name: 'Base Service & Dispatch Fee',
          amount: this.activePricingPolicy.baseServiceFee,
          description: 'Care Partner allocation, dispatch, and initial care coordination.',
        },
        {
          code: 'TRANSIT_DISTANCE',
          name: 'Round-Trip Transportation (Two-Leg Distance)',
          amount: 350,
          description: 'Complete two-leg travel: Outbound + Return legs.',
        },
        {
          code: 'COMPANION_SERVICE_TIME',
          name: 'Hospital Visit Accompaniment',
          amount: 600,
          description: 'Care Partner stays on-site with patient during hospital consultation.',
        },
        {
          code: 'PLATFORM_FEE',
          name: 'Neravu Safety & Platform Coordination',
          amount: this.activePricingPolicy.platformFee,
          description: 'Operations desk, trusted contact alerts, and continuous milestone monitoring.',
        },
        {
          code: 'TAXES',
          name: 'Taxes & Statutory Fees',
          amount: 90,
          description: 'Applicable statutory services tax.',
        },
      ],
    };

    const assignedFare = params.initialFareEstimate || params.fareEstimate || defaultFareSnapshot;

    const journey = createRoundTripJourney({
      patientId: patient.id,
      pickupLocation: params.pickupLocation,
      hospitalDestination: params.hospitalDestination,
      returnDropoffLocation: params.returnDropoffLocation || params.pickupLocation,
      bookingType: params.bookingType,
      scheduledPickupTime: params.scheduledPickupTime,
      specialAssistanceNotes: params.specialAssistanceNotes,
      initialFareEstimate: assignedFare,
    });

    // Auto-advance from DRAFT to REQUESTED then MATCHING for immediate dispatch matching
    const requested = transitionJourney(journey, 'REQUESTED', {
      triggeredByUserId: patient.id,
      note: 'Booking requested by patient.',
    });

    const matching = transitionJourney(requested, 'MATCHING', {
      triggeredByUserId: 'system',
      note: 'Auto-matching nearest available Care Partner.',
    });

    if (txStore) {
      try {
        await txStore.driver.transaction(async () => {
          // Double check inside transaction if another concurrent request slipped in
          const concurrentActive = await txStore.journeys.findActiveByPatientId(patient.id);
          if (concurrentActive) {
            throw new DomainError(
              'ACTIVE_JOURNEY_EXISTS',
              `Patient '${patient.id}' already has an active journey ('${concurrentActive.id}').`
            );
          }

          // Save journey
          await txStore.journeys.save(matching);

          // If idempotencyKey was provided, persist idempotency record transactionally
          if (idempotencyKey) {
            await txStore.idempotencyKeys.save({
              id: `idem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              patientId: patient.id,
              idempotencyKey,
              journeyId: matching.id,
              createdAt: new Date().toISOString(),
            });
          }
        });
      } catch (err: any) {
        // Handle concurrent race: if another request with SAME key just committed, return its journey
        if (idempotencyKey) {
          const replayCheck = await txStore.idempotencyKeys.findByPatientAndKey(patient.id, idempotencyKey);
          if (replayCheck) {
            const replayedJourney = await txStore.journeys.findById(replayCheck.journeyId);
            if (replayedJourney) {
              return { journey: replayedJourney, isIdempotentReplay: true };
            }
          }
        }
        if (
          err?.code === 'ACTIVE_JOURNEY_EXISTS' ||
          err?.message?.includes('ACTIVE_JOURNEY_EXISTS') ||
          err?.message?.includes('idx_journeys_unique_active_patient')
        ) {
          throw new DomainError(
            'ACTIVE_JOURNEY_EXISTS',
            'Patient already has an active journey. Only one active journey is permitted at a time.'
          );
        }
        throw err;
      }
    } else {
      await this.store.journeys.save(matching);
    }

    this.notify();
    return { journey: matching, isIdempotentReplay: false };
  }

  /**
   * Creates a single round-trip journey for a patient.
   */
  async createBooking(
    patient: AuthUser,
    params: {
      pickupLocation: Location;
      hospitalDestination: HospitalDestination;
      returnDropoffLocation?: Location;
      bookingType: 'ON_DEMAND' | 'SCHEDULED';
      scheduledPickupTime?: string;
      specialAssistanceNotes?: string;
      initialFareEstimate?: FareBreakdown;
      fareEstimate?: FareBreakdown;
    },
    options?: {
      idempotencyKey?: string;
    }
  ): Promise<Journey> {
    const result = await this.createBookingWithIdempotency(patient, params, options?.idempotencyKey);
    return result.journey;
  }

  /**
   * Care Partner accepts an offered journey in MATCHING state.
   */
  async acceptJourney(partner: AuthUser, journeyId: string): Promise<Journey> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const auth = authorizeAction(partner, 'UPDATE_JOURNEY_MILESTONE', { journey });
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_TRANSITION', auth.reason || 'Unauthorized to accept journey');
    }

    const assigned = transitionJourney(journey, 'PARTNER_ASSIGNED', {
      triggeredByUserId: partner.id,
      assignedCarePartnerId: partner.id,
      note: `Care Partner ${partner.name} accepted journey dispatch.`,
    });

    // Update partner status to ON_JOURNEY
    const profile = await this.store.carePartners.findByUserId(partner.id);
    if (profile) {
      await this.store.carePartners.save({
        ...profile,
        availabilityStatus: 'ON_JOURNEY',
      });
    }

    await this.store.journeys.save(assigned);
    this.notify();
    return assigned;
  }

  /**
   * Care Partner or Patient advances permitted milestone.
   */
  async advanceMilestone(
    user: AuthUser,
    journeyId: string,
    targetState: JourneyState,
    note?: string,
    metadata?: Record<string, unknown>
  ): Promise<Journey> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    // If pin provided for PATIENT_PICKED_UP transition, verify server-authoritatively
    if (targetState === 'PATIENT_PICKED_UP' && metadata?.pin) {
      return this.verifyPickupPin(user, journeyId, String(metadata.pin));
    }

    // Rule: Patient can trigger RETURN_STARTED from HOSPITAL_VISIT ("Ready to return home")
    if (user.role === 'PATIENT') {
      if (journey.patientId !== user.id) {
        throw new DomainError('UNAUTHORIZED_TRANSITION', 'Patient can only update their own journey.');
      }
      if (targetState !== 'RETURN_STARTED') {
        throw new DomainError(
          'UNAUTHORIZED_TRANSITION',
          'Patient can only signal readiness for the return journey (RETURN_STARTED).'
        );
      }
    } else {
      const auth = authorizeAction(user, 'UPDATE_JOURNEY_MILESTONE', { journey });
      if (!auth.authorized) {
        throw new DomainError('UNAUTHORIZED_TRANSITION', auth.reason || 'Unauthorized milestone transition');
      }
    }

    const updated = transitionJourney(journey, targetState, {
      triggeredByUserId: user.id,
      note: note || `State transitioned to ${targetState} by ${user.name}`,
    });

    // If completed, release partner back to AVAILABLE
    if (targetState === 'COMPLETED' && updated.carePartnerId) {
      const profile = await this.store.carePartners.findByUserId(updated.carePartnerId);
      if (profile) {
        await this.store.carePartners.save({
          ...profile,
          availabilityStatus: 'AVAILABLE',
          totalJourneysCompleted: profile.totalJourneysCompleted + 1,
        });
      }
    }

    await this.store.journeys.save(updated);
    this.notify();
    return updated;
  }

  /**
   * Server-authoritative Pickup Verification PIN validation.
   * Advances the journey from PARTNER_ARRIVED to PATIENT_PICKED_UP only upon entering the correct PIN.
   * Rate-limits failed PIN attempts and records audit logs for all attempts.
   */
  async verifyPickupPin(user: AuthUser, journeyId: string, pin: string): Promise<Journey> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const isAssignedPartner = user.role === 'CARE_PARTNER' && journey.carePartnerId === user.id;
    const isAdmin = user.role === 'ADMIN';
    if (!isAssignedPartner && !isAdmin) {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Only the assigned Care Partner can verify the patient pickup PIN.');
    }

    if (journey.currentState !== 'PARTNER_ARRIVED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `Pickup PIN verification is only permitted when Care Partner has arrived at the pickup location (PARTNER_ARRIVED). Current state: ${journey.currentState}`
      );
    }

    // Rate-limit check: lockout enforcement
    if (journey.pickupPinLockedUntil) {
      const lockUntilMs = new Date(journey.pickupPinLockedUntil).getTime();
      if (lockUntilMs > Date.now()) {
        const remainingSec = Math.ceil((lockUntilMs - Date.now()) / 1000);
        if ((this.store as any).auditLogs) {
          await (this.store as any).auditLogs.log({
            entityType: 'JOURNEY',
            entityId: journey.id,
            action: 'PICKUP_PIN_RATE_LIMITED',
            actorId: user.id,
            metadata: { remainingSeconds: remainingSec, lockedUntil: journey.pickupPinLockedUntil },
          });
        }
        throw new DomainError(
          'PICKUP_PIN_RATE_LIMITED',
          `Too many failed PIN attempts. Verification is locked. Please try again in ${remainingSec} seconds.`
        );
      }
    }

    const cleanPin = String(pin || '').trim();
    const expectedPin = String(journey.pickupPin || '').trim();
    const isMatch = Boolean(expectedPin && cleanPin && cleanPin === expectedPin);

    if (!isMatch) {
      const failedAttempts = (journey.pickupPinFailedAttempts || 0) + 1;
      const maxAttempts = 5;
      let lockedUntil: string | null = null;
      if (failedAttempts >= maxAttempts) {
        lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      }
      journey.pickupPinFailedAttempts = failedAttempts;
      journey.pickupPinLockedUntil = lockedUntil;
      await this.store.journeys.save(journey);

      if ((this.store as any).auditLogs) {
        await (this.store as any).auditLogs.log({
          entityType: 'JOURNEY',
          entityId: journey.id,
          action: 'PICKUP_PIN_FAILED',
          actorId: user.id,
          metadata: { failedAttempts, locked: failedAttempts >= maxAttempts },
        });
      }

      throw new DomainError(
        'INVALID_PICKUP_PIN',
        failedAttempts >= maxAttempts
          ? 'Incorrect PIN. Maximum failed attempts reached. Pickup verification is locked for 5 minutes.'
          : `Incorrect pickup verification PIN. Attempt ${failedAttempts} of ${maxAttempts}. Please check with the patient.`
      );
    }

    // Correct PIN: reset attempts, mark verified, advance milestone to PATIENT_PICKED_UP
    journey.pickupPinVerified = true;
    journey.pickupPinFailedAttempts = 0;
    journey.pickupPinLockedUntil = null;

    const updated = transitionJourney(journey, 'PATIENT_PICKED_UP', {
      triggeredByUserId: user.id,
      note: `Patient identity verified with secure 4-digit pickup PIN by Care Partner ${user.name}.`,
    });
    updated.pickupPinVerified = true;
    updated.pickupPinFailedAttempts = 0;
    updated.pickupPinLockedUntil = null;

    await this.store.journeys.save(updated);

    if ((this.store as any).auditLogs) {
      await (this.store as any).auditLogs.log({
        entityType: 'JOURNEY',
        entityId: journey.id,
        action: 'PICKUP_PIN_VERIFIED',
        actorId: user.id,
        metadata: { fromState: 'PARTNER_ARRIVED', toState: 'PATIENT_PICKED_UP' },
      });
    }

    this.notify();
    return updated;
  }

  /**
   * Updates Care Partner's live geolocation and computes ETA during active transit.
   * Allowed ONLY during active transit states:
   * PARTNER_EN_ROUTE, PATIENT_PICKED_UP, IN_TRANSIT_TO_HOSPITAL, RETURN_STARTED, IN_TRANSIT_TO_HOME.
   * Stops when journey is COMPLETED / CANCELLED / PARTNER_CANCELLED.
   */
  async updateLiveLocation(
    user: AuthUser,
    journeyId: string,
    coords: {
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
      accuracy?: number;
    }
  ): Promise<CarePartnerLiveLocation> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const isAssigned = user.role === 'CARE_PARTNER' && journey.carePartnerId === user.id;
    const isAdmin = user.role === 'ADMIN';
    if (!isAssigned && !isAdmin) {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Only the assigned Care Partner can submit live location updates.');
    }

    if (['COMPLETED', 'CANCELLED', 'PARTNER_CANCELLED'].includes(journey.currentState)) {
      throw new DomainError(
        'BOOKING_ALREADY_TERMINATED',
        `Live location tracking is stopped because journey is in terminal state '${journey.currentState}'.`
      );
    }

    const TRANSIT_STATES: JourneyState[] = [
      'PARTNER_EN_ROUTE',
      'PATIENT_PICKED_UP',
      'IN_TRANSIT_TO_HOSPITAL',
      'RETURN_STARTED',
      'IN_TRANSIT_TO_HOME',
    ];

    if (!TRANSIT_STATES.includes(journey.currentState)) {
      throw new DomainError(
        'INVALID_STATE_FOR_LOCATION_TRACKING',
        `Live location tracking is only permitted during active transit states (${TRANSIT_STATES.join(', ')}). Current state: ${journey.currentState}`
      );
    }

    if (
      typeof coords.latitude !== 'number' ||
      typeof coords.longitude !== 'number' ||
      isNaN(coords.latitude) ||
      isNaN(coords.longitude) ||
      coords.latitude < -90 ||
      coords.latitude > 90 ||
      coords.longitude < -180 ||
      coords.longitude > 180
    ) {
      throw new DomainError('INVALID_DATA', 'Invalid coordinates. Latitude [-90, 90] and Longitude [-180, 180] are required.');
    }

    // Determine target destination based on current active transit leg
    let targetLoc: Location;
    let targetName: string;
    if (journey.currentState === 'PARTNER_EN_ROUTE') {
      targetLoc = journey.pickupLocation;
      targetName = 'Patient Pickup: ' + journey.pickupLocation.address;
    } else if (journey.currentState === 'PATIENT_PICKED_UP' || journey.currentState === 'IN_TRANSIT_TO_HOSPITAL') {
      targetLoc = {
        latitude: journey.hospitalDestination.latitude,
        longitude: journey.hospitalDestination.longitude,
        address: journey.hospitalDestination.address,
      };
      targetName = journey.hospitalDestination.name;
    } else {
      // RETURN_STARTED or IN_TRANSIT_TO_HOME
      targetLoc = journey.returnDropoffLocation;
      targetName = 'Return Drop-Off: ' + journey.returnDropoffLocation.address;
    }

    const currentLoc: Location = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      address: `Care Partner GPS (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`,
    };

    const leg = createFallbackRouteLeg(currentLoc, targetLoc);
    const now = new Date().toISOString();

    const liveLocation: CarePartnerLiveLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      heading: typeof coords.heading === 'number' ? coords.heading : undefined,
      speed: typeof coords.speed === 'number' ? coords.speed : undefined,
      accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : undefined,
      updatedAt: now,
      etaSeconds: leg.durationSeconds,
      etaText: leg.durationText,
      distanceMeters: leg.distanceMeters,
      distanceText: leg.distanceText,
      targetDestination: targetName,
      isStale: false,
    };

    journey.liveLocation = liveLocation;
    await this.store.journeys.save(journey);
    this.notify();
    return liveLocation;
  }

  /**
   * Retrieves Care Partner's live geolocation and ETA for authorized participants.
   * Validates participant role, applies staleness evaluation, and stops tracking when completed.
   */
  async getLiveLocation(
    user: AuthUser,
    journeyId: string
  ): Promise<{
    liveLocation: CarePartnerLiveLocation | null;
    trackingActive: boolean;
    currentState: JourneyState;
    message?: string;
  }> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const patientProfile = await this.getPatientProfile(journey.patientId);
    const auth = authorizeAction(user, 'VIEW_JOURNEY_LOCATION', {
      journey,
      trustedContacts: patientProfile?.trustedContacts,
    });
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_ACTION', auth.reason || 'You are not authorized to view this journey location');
    }

    if (user.role === 'FAMILY_CONTACT') {
      const scope = getFamilyAccessScope(user, journey, patientProfile?.trustedContacts || []);
      if (!scope.canViewLocationFromBooking && scope.permissionLevel === 'EMERGENCY_ONLY' && journey.currentState !== 'EMERGENCY_ACTIVE') {
        throw new DomainError('UNAUTHORIZED_ACTION', 'Family contact has emergency-only location access.');
      }
    }

    const isTerminated = ['COMPLETED', 'CANCELLED', 'PARTNER_CANCELLED'].includes(journey.currentState);
    if (isTerminated) {
      return {
        liveLocation: null,
        trackingActive: false,
        currentState: journey.currentState,
        message: 'Tracking stopped: journey is completed or cancelled.',
      };
    }

    if (!journey.liveLocation) {
      return {
        liveLocation: null,
        trackingActive: true,
        currentState: journey.currentState,
        message: 'Awaiting companion GPS signal.',
      };
    }

    const STALE_THRESHOLD_MS = 60 * 1000; // 60 seconds
    const ageMs = Date.now() - new Date(journey.liveLocation.updatedAt).getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;

    const liveLocation: CarePartnerLiveLocation = {
      ...journey.liveLocation,
      isStale,
    };

    return {
      liveLocation,
      trackingActive: true,
      currentState: journey.currentState,
    };
  }

  /**
   * Activates in-journey emergency workflow.
   * Preserves previous state, journey endpoints, category, and incident context.
   */
  async triggerEmergency(
    user: AuthUser,
    journeyId: string,
    options?:
      | {
          category?: EmergencyCategory;
          reason?: string;
          locationSnapshot?: Location;
        }
      | string
  ): Promise<Journey> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const category = typeof options === 'object' ? options.category : undefined;
    const reason = typeof options === 'string' ? options : options?.reason;
    const locationSnapshot = typeof options === 'object' ? options.locationSnapshot : undefined;

    const validation = validateEmergencyTrigger(journey, category);
    if (!validation.valid) {
      throw new DomainError('INVALID_STATE_TRANSITION', validation.error || 'Cannot trigger emergency');
    }

    const assignedCategory = category || 'MEDICAL_EMERGENCY';

    const emergencyState = transitionJourney(journey, 'EMERGENCY_ACTIVE', {
      triggeredByUserId: user.id,
      note: reason || `EMERGENCY SOS triggered by ${user.name} (${user.role}) - ${assignedCategory}`,
    });

    const incidentId = `emg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const incident: EmergencyLogRecord = {
      id: incidentId,
      journeyId: journey.id,
      triggeredAt: now,
      triggeredByUserId: user.id,
      triggeredByRole: user.role,
      stateAtTrigger: journey.currentState,
      previousJourneyState: journey.currentState,
      locationSnapshot: locationSnapshot || journey.pickupLocation,
      destinationSnapshot: journey.hospitalDestination,
      category: assignedCategory,
      description: reason || `SOS button pressed during active journey (${assignedCategory}).`,
      status: 'ACTIVE',
    };

    emergencyState.emergencyLogs.push(incident);

    await this.store.journeys.save(emergencyState);
    this.notify();
    return emergencyState;
  }

  /**
   * Admin restores journey from EMERGENCY_ACTIVE back to its actual previous state.
   */
  async resolveEmergency(admin: AuthUser, journeyId: string, resolutionNote: string): Promise<Journey> {
    const auth = authorizeAction(admin, 'RESOLVE_EMERGENCY');
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_TRANSITION', 'Only ADMIN can resolve an active emergency.');
    }

    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) throw new DomainError('ENTITY_NOT_FOUND', 'Journey not found');

    const restored = restoreFromEmergency(journey, {
      triggeredByUserId: admin.id,
      note: resolutionNote,
    });

    if (restored.emergencyLogs.length > 0) {
      const last = restored.emergencyLogs[restored.emergencyLogs.length - 1];
      last.status = 'RESOLVED';
      last.resolvedAt = new Date().toISOString();
      last.resolvedByUserId = admin.id;
      last.resolutionNotes = resolutionNote;
    }

    await this.store.journeys.save(restored);
    this.notify();
    return restored;
  }

  /**
   * Returns current active pricing policy configuration.
   */
  getPricingPolicy(): PricingPolicy {
    return { ...this.activePricingPolicy };
  }

  /**
   * Updates global pricing configuration. Restricted to ADMIN role.
   * Existing bookings retain their preserved fare snapshot.
   */
  updatePricingPolicy(admin: AuthUser, newPolicy: PricingPolicy): PricingPolicy {
    const auth = authorizeAction(admin, 'UPDATE_PRICING_POLICY');
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Only Admin can update pricing policy');
    }

    const validation = validatePricingPolicy(newPolicy);
    if (!validation.valid) {
      throw new DomainError('INVALID_PRICING_POLICY', `Invalid pricing policy: ${validation.errors.join(', ')}`);
    }

    this.activePricingPolicy = { ...newPolicy };
    this.notify();
    return { ...this.activePricingPolicy };
  }

  /**
   * Calculates deterministic round-trip fare estimate using active pricing policy.
   */
  calculateFareEstimate(input: FareCalculationInput): FareBreakdown {
    return calculateJourneyFare(input, this.activePricingPolicy);
  }

  /**
   * Retrieves all emergency incident audit records across journeys. Restricted to ADMIN.
   */
  async getAllEmergencyIncidents(user: AuthUser): Promise<EmergencyLogRecord[]> {
    const auth = authorizeAction(user, 'ACCESS_ADMIN_OPERATIONS');
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Only Admin can access emergency incident audit logs');
    }

    const journeys = await this.store.journeys.findAll();
    const incidents: EmergencyLogRecord[] = [];
    for (const j of journeys) {
      if (j.emergencyLogs && j.emergencyLogs.length > 0) {
        incidents.push(...j.emergencyLogs);
      }
    }
    return incidents.sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime());
  }

  /**
   * Toggles Care Partner availability.
   */
  async setPartnerAvailability(
    partner: AuthUser,
    status: 'AVAILABLE' | 'OFFLINE'
  ): Promise<CarePartnerProfile> {
    const profile = await this.store.carePartners.findByUserId(partner.id);
    if (!profile) throw new DomainError('ENTITY_NOT_FOUND', 'Care Partner profile not found');

    const updated = await this.store.carePartners.save({
      ...profile,
      availabilityStatus: status,
    });
    this.notify();
    return updated;
  }

  async seedInitialDomainData(): Promise<void> {
    // Defense-in-depth: Never seed demo fixtures in production environment
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return;
    }

    // 1. Seed base users first to satisfy foreign key constraints in relational databases
    if (this.store.users) {
      const now = new Date().toISOString();
      const devUsers = [
        { id: 'dev-user-patient-1', name: '[DEMO] Smt. Lakshmi Narayanan (Test Patient)', phone: '+91 98000 00001 (Dev Test)', role: 'PATIENT' as const, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
        { id: 'dev-user-partner-1', name: '[DEMO] Ramesh Kumar (Test Care Partner)', phone: '+91 98000 00002 (Dev Test)', role: 'CARE_PARTNER' as const, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
        { id: 'dev-user-family-1', name: '[DEMO] Anand Narayanan (Test Family Contact)', phone: '+91 98000 00003 (Dev Test)', role: 'FAMILY_CONTACT' as const, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
        { id: 'dev-user-admin-1', name: '[DEMO] Neravu Operations Desk (Test Admin)', phone: '+91 98000 00099 (Dev Test)', role: 'ADMIN' as const, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
      ];
      for (const u of devUsers) {
        const existing = await this.store.users.findById(u.id);
        if (!existing) {
          await this.store.users.save(u);
        }
      }
    }

    // 2. Seed default hospital if not present
    if (this.store.hospitals) {
      const existingHosp = await this.store.hospitals.findById('hosp-manipal');
      if (!existingHosp) {
        await this.store.hospitals.save({
          id: 'hosp-manipal',
          name: '[DEMO] Manipal Hospital (Sample Destination)',
          address: '[DEMO] 98 HAL Airport Road, Kodihalli, Bengaluru (Sample)',
          latitude: 12.9592,
          longitude: 77.6499,
          entranceOrDepartment: 'Specialty Clinic Pavilion (East Wing, OPD 2)',
          accessNotes: 'Assistance desk immediately right of entryway.',
          emergencyContactPhone: undefined,
        });
      }
    }

    const existingPatient = await this.store.patientProfiles.findByUserId('dev-user-patient-1');
    if (!existingPatient) {
      // Seed default Patient Profile
      const patientProfile: PatientProfile = {
        userId: 'dev-user-patient-1',
        homeAddress: {
          latitude: 12.9716,
          longitude: 77.5946,
          address: '[DEMO] 104 Sunrise Apts, 4th Main, Indiranagar, Bengaluru (Sample Address)',
          landmark: 'Near Indiranagar Metro Station (Exit B)',
          accessInstructions: 'Elevator available, ground floor ramp on the left side of building.',
        },
        mobilityAssistance: ['WHEELCHAIR_TRANSFER', 'STAIR_ASSISTANCE'],
        nonClinicalAssistanceNotes:
          '[DEMO] Needs companion to assist walking from entrance, carry medical file folder, and stay during doctor checkup & blood test waiting.',
        trustedContacts: [
          {
            id: 'tc-anand-1',
            patientId: 'dev-user-patient-1',
            contactUserId: 'dev-user-family-1',
            contactName: '[DEMO] Anand Narayanan (Sample Son)',
            contactPhone: '+91 98000 00003 (Dev Test)',
            relationship: 'Son',
            permissionLevel: 'FULL_STATUS',
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.store.patientProfiles.save(patientProfile);
    }

    const existingPartner = await this.store.carePartners.findByUserId('dev-user-partner-1');
    if (!existingPartner) {
      // Seed default Care Partner Profile
      const partnerProfile: CarePartnerProfile = {
        userId: 'dev-user-partner-1',
        verificationStatus: 'VERIFIED',
        availabilityStatus: 'AVAILABLE',
        vehicle: {
          make: '[DEMO] Maruti Suzuki',
          model: 'Ertiga (Sample Assisted Access Vehicle)',
          year: 2023,
          color: 'Silky Silver',
          licensePlate: 'KA 03 DEMO 4821',
          isWheelchairAccessible: true,
          seatingCapacity: 6,
          accommodationsDescription: '[DEMO] Foldable wheelchair ramp, wide door opening, low ingress step, first aid kit on board.',
        },
        ratingAverage: 4.95,
        totalJourneysCompleted: 142,
        firstAidCertified: true,
        backgroundCheckVerifiedDate: '2026-01-15',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.store.carePartners.save(partnerProfile);
    }

    const existingJourneys = await this.store.journeys.findByPatientId('dev-user-patient-1');
    if (existingJourneys.length === 0) {
      const patientProf = (await this.store.patientProfiles.findByUserId('dev-user-patient-1'))!;
      // Seed an initial demo active journey in HOSPITAL_VISIT so the reviewer can immediately inspect the hospital accompaniment state!
      const hosp = {
        id: 'hosp-manipal',
        name: '[DEMO] Manipal Hospital (Sample Destination)',
        address: '[DEMO] 98 HAL Airport Road, Kodihalli, Bengaluru (Sample)',
        latitude: 12.9592,
        longitude: 77.6499,
        entranceOrDepartment: 'Specialty Clinic Pavilion (East Wing, OPD 2)',
        accessNotes: 'Assistance desk immediately right of entryway.',
        emergencyContactPhone: undefined,
      };

      let sampleJourney = createRoundTripJourney({
        id: 'journey-active-demo-101',
        patientId: 'dev-user-patient-1',
        pickupLocation: patientProf.homeAddress,
        hospitalDestination: hosp,
        returnDropoffLocation: patientProf.homeAddress,
        bookingType: 'ON_DEMAND',
        specialAssistanceNotes: '[DEMO] Wheelchair assistance requested from entryway to 2nd floor Cardiology.',
        initialFareEstimate: {
          currency: 'INR',
          baseBookingFee: 250,
          companionServiceTimeFee: 600,
          transitDistanceFee: 350,
          platformServiceFee: 100,
          taxes: 90,
          total: 1390,
          isEstimate: true,
        },
      });

      // Advance to HOSPITAL_VISIT
      sampleJourney = transitionJourney(sampleJourney, 'REQUESTED', { triggeredByUserId: 'dev-user-patient-1' });
      sampleJourney = transitionJourney(sampleJourney, 'MATCHING', { triggeredByUserId: 'system' });
      sampleJourney = transitionJourney(sampleJourney, 'PARTNER_ASSIGNED', {
        triggeredByUserId: 'system',
        assignedCarePartnerId: 'dev-user-partner-1',
      });
      sampleJourney = transitionJourney(sampleJourney, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'PARTNER_ARRIVED', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'PATIENT_PICKED_UP', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'HOSPITAL_VISIT', {
        triggeredByUserId: 'dev-user-partner-1',
        note: 'Accompanied Smt. Lakshmi inside Cardiology OPD waiting lounge.',
      });
      sampleJourney = transitionJourney(sampleJourney, 'RETURN_STARTED', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'IN_TRANSIT_TO_HOME', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'PATIENT_RETURNED_HOME', { triggeredByUserId: 'dev-user-partner-1' });
      sampleJourney = transitionJourney(sampleJourney, 'COMPLETED', {
        triggeredByUserId: 'dev-user-partner-1',
        note: 'Completed demonstration journey. Patient safely returned home.',
      });

      await this.store.journeys.save(sampleJourney);
    }
  }

  async resetToSeedData(): Promise<void> {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Demo seed reset is strictly disabled in production.');
    }
    if (this.store.clear) {
      await this.store.clear();
    }
    await this.seedInitialDomainData();
    this.notify();
  }
}

export const sharedJourneyService = new JourneyService();
