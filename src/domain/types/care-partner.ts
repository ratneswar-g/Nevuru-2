export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type AvailabilityStatus = 'AVAILABLE' | 'ON_JOURNEY' | 'OFFLINE';

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
  firstAidCertified?: boolean;
  backgroundCheckVerifiedDate?: string;
  ratingAverage: number;
  totalJourneysCompleted: number;
  createdAt?: string;
  updatedAt?: string;
}
