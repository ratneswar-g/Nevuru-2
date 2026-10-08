export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type AvailabilityStatus = 'AVAILABLE' | 'ON_JOURNEY' | 'OFFLINE';

export type ComplianceDocumentType =
  | 'DRIVING_LICENCE'
  | 'VEHICLE_INSURANCE'
  | 'COMMERCIAL_FITNESS_CERTIFICATE';

export const MANDATORY_COMPLIANCE_DOCUMENTS: readonly ComplianceDocumentType[] = [
  'DRIVING_LICENCE',
  'VEHICLE_INSURANCE',
  'COMMERCIAL_FITNESS_CERTIFICATE',
] as const;

export type ComplianceDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface ComplianceDocument {
  id: string;
  carePartnerId: string;
  type: ComplianceDocumentType;
  documentNumber: string;
  issueDate?: string;
  expiryDate: string;
  status: ComplianceDocumentStatus;
  verifiedAt?: string;
  verifiedByAdminId?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CarePartnerComplianceSummary {
  carePartnerId: string;
  isCompliant: boolean;
  overallStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'PENDING_REVIEW';
  missingDocumentTypes: ComplianceDocumentType[];
  expiredDocumentTypes: ComplianceDocumentType[];
  pendingDocumentTypes: ComplianceDocumentType[];
  rejectedDocumentTypes: ComplianceDocumentType[];
  documents: ComplianceDocument[];
}

export interface VehicleInfo {
  make: string;
  model: string;
  year: number;
  color?: string;
  licensePlate: string;
  isWheelchairAccessible?: boolean;
  seatingCapacity?: number;
  accessibilityFeatures?: string[];
  accommodationsDescription?: string;
}

export interface CarePartnerProfile {
  userId: string;
  verificationStatus: VerificationStatus;
  availabilityStatus: AvailabilityStatus;
  vehicle?: VehicleInfo;
  documents?: ComplianceDocument[];
  firstAidCertified?: boolean;
  backgroundCheckVerifiedDate?: string;
  ratingAverage: number;
  totalJourneysCompleted: number;
  createdAt?: string;
  updatedAt?: string;
}
