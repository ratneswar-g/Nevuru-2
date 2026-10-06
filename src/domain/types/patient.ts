import { Location } from './location.ts';
import { TrustedContact } from './trusted-contact.ts';

export type MobilityAssistance =
  | 'INDEPENDENT_WALKER'
  | 'CANE_OR_CRUTCHES'
  | 'WHEELCHAIR_TRANSFER'
  | 'STRETCHER_REQUIRED'
  | 'STAIR_ASSISTANCE'
  | string;

export interface PatientProfile {
  userId: string;
  homeAddress: Location;
  mobilityAssistance?: MobilityAssistance[];
  mobilityNotes?: string;
  preferredHospitalId?: string;
  nonClinicalAssistanceNotes?: string;
  trustedContacts: TrustedContact[];
  createdAt?: string;
  updatedAt?: string;
}
