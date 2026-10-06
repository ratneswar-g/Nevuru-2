export type ContactPermissionLevel =
  | 'EMERGENCY_ONLY'
  | 'TRACKING_ONLY'
  | 'FULL_ACCESS'
  | 'FULL_STATUS'
  | string;

export type PermissionLevel = ContactPermissionLevel;

export interface TrustedContact {
  id: string;
  patientId?: string;
  name?: string;
  relationship: string;
  phone?: string;
  contactUserId?: string;
  contactName?: string;
  contactPhone?: string;
  permissionLevel: ContactPermissionLevel;
  canViewStatus?: boolean;
  canViewLocation?: boolean;
  canViewClinicalContext?: boolean;
  canReceiveEmergencyNotifications?: boolean;
  canCommunicateWithPartner?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
