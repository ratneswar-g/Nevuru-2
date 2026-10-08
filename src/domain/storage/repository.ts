import {
  User,
  PatientProfile,
  CarePartnerProfile,
  HospitalDestination,
  Journey,
  MANDATORY_COMPLIANCE_DOCUMENTS,
  PaymentOrder,
} from '../types/index.ts';
import { isDocumentExpired } from '../care-partner/compliance.ts';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  save(user: User): Promise<User>;
}

export interface IPatientProfileRepository {
  findByUserId(userId: string): Promise<PatientProfile | null>;
  save(profile: PatientProfile): Promise<PatientProfile>;
}

export interface ICarePartnerProfileRepository {
  findByUserId(userId: string): Promise<CarePartnerProfile | null>;
  findAvailable(): Promise<CarePartnerProfile[]>;
  findAll(): Promise<CarePartnerProfile[]>;
  save(profile: CarePartnerProfile): Promise<CarePartnerProfile>;
}

export interface IHospitalRepository {
  findById(id: string): Promise<HospitalDestination | null>;
  findAll(): Promise<HospitalDestination[]>;
  save(hospital: HospitalDestination): Promise<HospitalDestination>;
}

export interface IJourneyRepository {
  findById(id: string): Promise<Journey | null>;
  findByPatientId(patientId: string): Promise<Journey[]>;
  findByCarePartnerId(carePartnerId: string): Promise<Journey[]>;
  findActiveByPatientId(patientId: string): Promise<Journey | null>;
  findAll(): Promise<Journey[]>;
  save(journey: Journey): Promise<Journey>;
}

export interface IPaymentRepository {
  findById(id: string): Promise<PaymentOrder | null>;
  findByJourneyId(journeyId: string): Promise<PaymentOrder[]>;
  findByProviderOrderId(providerOrderId: string): Promise<PaymentOrder | null>;
  findByIdempotencyKey(key: string): Promise<PaymentOrder | null>;
  findByPatientId(patientId: string): Promise<PaymentOrder[]>;
  findAll(): Promise<PaymentOrder[]>;
  save(order: PaymentOrder): Promise<PaymentOrder>;
}

export class InMemoryUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findByPhone(phone: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.phone === phone) return u;
    }
    return null;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async save(user: User): Promise<User> {
    const updated: User = { ...user, updatedAt: new Date().toISOString() };
    this.users.set(user.id, updated);
    return updated;
  }
}

export class InMemoryPatientProfileRepository implements IPatientProfileRepository {
  private profiles = new Map<string, PatientProfile>();

  async findByUserId(userId: string): Promise<PatientProfile | null> {
    return this.profiles.get(userId) || null;
  }

  async save(profile: PatientProfile): Promise<PatientProfile> {
    const updated: PatientProfile = { ...profile, updatedAt: new Date().toISOString() };
    this.profiles.set(profile.userId, updated);
    return updated;
  }
}

export class InMemoryCarePartnerProfileRepository implements ICarePartnerProfileRepository {
  private profiles = new Map<string, CarePartnerProfile>();

  async findByUserId(userId: string): Promise<CarePartnerProfile | null> {
    return this.profiles.get(userId) || null;
  }

  async findAvailable(): Promise<CarePartnerProfile[]> {
    return Array.from(this.profiles.values()).filter((p) => {
      if (p.availabilityStatus !== 'AVAILABLE' || p.verificationStatus !== 'VERIFIED') return false;
      if (p.documents && p.documents.length > 0) {
        const hasExpired = p.documents.some(
          (d) => MANDATORY_COMPLIANCE_DOCUMENTS.includes(d.type) && isDocumentExpired(d)
        );
        if (hasExpired) return false;
      }
      return true;
    });
  }

  async findAll(): Promise<CarePartnerProfile[]> {
    return Array.from(this.profiles.values());
  }

  async save(profile: CarePartnerProfile): Promise<CarePartnerProfile> {
    const updated: CarePartnerProfile = { ...profile, updatedAt: new Date().toISOString() };
    this.profiles.set(profile.userId, updated);
    return updated;
  }
}

export class InMemoryHospitalRepository implements IHospitalRepository {
  private hospitals = new Map<string, HospitalDestination>();

  constructor() {
    this.seedDefaults();
  }

  async findById(id: string): Promise<HospitalDestination | null> {
    return this.hospitals.get(id) || null;
  }

  async findAll(): Promise<HospitalDestination[]> {
    return Array.from(this.hospitals.values());
  }

  async save(hospital: HospitalDestination): Promise<HospitalDestination> {
    this.hospitals.set(hospital.id, hospital);
    return hospital;
  }

  private seedDefaults() {
    const defaultHospitals: HospitalDestination[] = [
      {
        id: 'hosp-apollo',
        name: '[DEMO] Apollo Medical Center (Sample Destination)',
        address: '[DEMO] 21 Greams Lane, Thousand Lights, Chennai (Sample)',
        latitude: 13.0604,
        longitude: 80.2496,
        entranceOrDepartment: 'Main Outpatient Pavilion Gate 2',
        accessNotes: 'Wheelchair assistance ramp at entrance.',
        // Real hospital emergency phone numbers must not be invented without verification
        emergencyContactPhone: undefined,
      },
      {
        id: 'hosp-fortis',
        name: '[DEMO] Fortis Memorial Institute (Sample Destination)',
        address: '[DEMO] Sector 44, Opposite HUDA City Centre, Gurugram (Sample)',
        latitude: 28.4595,
        longitude: 77.0725,
        entranceOrDepartment: 'OPD Tower - Ground Floor Reception',
        accessNotes: 'Dedicated drop-off bay for companions and patients.',
        emergencyContactPhone: undefined,
      },
      {
        id: 'hosp-manipal',
        name: '[DEMO] Manipal Hospital (Sample Destination)',
        address: '[DEMO] 98 HAL Airport Road, Kodihalli, Bengaluru (Sample)',
        latitude: 12.9592,
        longitude: 77.6499,
        entranceOrDepartment: 'Specialty Clinic Pavilion (East Wing)',
        accessNotes: 'Companion assistance desk immediately inside.',
        emergencyContactPhone: undefined,
      },
    ];

    for (const h of defaultHospitals) {
      this.hospitals.set(h.id, h);
    }
  }
}

export class InMemoryJourneyRepository implements IJourneyRepository {
  private journeys = new Map<string, Journey>();

  async findById(id: string): Promise<Journey | null> {
    return this.journeys.get(id) || null;
  }

  async findByPatientId(patientId: string): Promise<Journey[]> {
    return Array.from(this.journeys.values()).filter((j) => j.patientId === patientId);
  }

  async findByCarePartnerId(carePartnerId: string): Promise<Journey[]> {
    return Array.from(this.journeys.values()).filter(
      (j) => j.carePartnerId === carePartnerId
    );
  }

  async findActiveByPatientId(patientId: string): Promise<Journey | null> {
    const active = Array.from(this.journeys.values()).find(
      (j) =>
        j.patientId === patientId &&
        j.currentState !== 'COMPLETED' &&
        j.currentState !== 'CANCELLED'
    );
    return active || null;
  }

  async findAll(): Promise<Journey[]> {
    return Array.from(this.journeys.values());
  }

  async save(journey: Journey): Promise<Journey> {
    const updated: Journey = { ...journey, updatedAt: new Date().toISOString() };
    this.journeys.set(journey.id, updated);
    return updated;
  }
}

export class InMemoryPaymentRepository implements IPaymentRepository {
  private payments = new Map<string, PaymentOrder>();

  async findById(id: string): Promise<PaymentOrder | null> {
    return this.payments.get(id) || null;
  }

  async findByJourneyId(journeyId: string): Promise<PaymentOrder[]> {
    return Array.from(this.payments.values())
      .filter((p) => p.journeyId === journeyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentOrder | null> {
    return (
      Array.from(this.payments.values()).find((p) => p.providerOrderId === providerOrderId) || null
    );
  }

  async findByIdempotencyKey(key: string): Promise<PaymentOrder | null> {
    return (
      Array.from(this.payments.values()).find((p) => p.idempotencyKey === key) || null
    );
  }

  async findByPatientId(patientId: string): Promise<PaymentOrder[]> {
    return Array.from(this.payments.values())
      .filter((p) => p.patientId === patientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findAll(): Promise<PaymentOrder[]> {
    return Array.from(this.payments.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async save(order: PaymentOrder): Promise<PaymentOrder> {
    const updated: PaymentOrder = { ...order, updatedAt: new Date().toISOString() };
    this.payments.set(order.id, updated);
    return updated;
  }
}

/**
 * Unified domain store interface contract.
 */
export interface IDomainStore {
  users: IUserRepository;
  patientProfiles: IPatientProfileRepository;
  carePartners: ICarePartnerProfileRepository;
  hospitals: IHospitalRepository;
  journeys: IJourneyRepository;
  payments?: IPaymentRepository;
  auditLogs?: any;
  clear?(): Promise<void>;
}

/**
 * Composite container for in-memory repositories.
 */
export class InMemoryDomainStore implements IDomainStore {
  public users: InMemoryUserRepository;
  public patientProfiles: InMemoryPatientProfileRepository;
  public carePartners: InMemoryCarePartnerProfileRepository;
  public hospitals: InMemoryHospitalRepository;
  public journeys: InMemoryJourneyRepository;
  public payments: InMemoryPaymentRepository;

  constructor() {
    this.users = new InMemoryUserRepository();
    this.patientProfiles = new InMemoryPatientProfileRepository();
    this.carePartners = new InMemoryCarePartnerProfileRepository();
    this.hospitals = new InMemoryHospitalRepository();
    this.journeys = new InMemoryJourneyRepository();
    this.payments = new InMemoryPaymentRepository();
  }

  async clear(): Promise<void> {
    this.users = new InMemoryUserRepository();
    this.patientProfiles = new InMemoryPatientProfileRepository();
    this.carePartners = new InMemoryCarePartnerProfileRepository();
    this.hospitals = new InMemoryHospitalRepository();
    this.journeys = new InMemoryJourneyRepository();
    this.payments = new InMemoryPaymentRepository();
  }
}
