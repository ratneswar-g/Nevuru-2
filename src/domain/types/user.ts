export type UserRole = 'PATIENT' | 'CARE_PARTNER' | 'FAMILY_CONTACT' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export interface User {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  status?: UserStatus;
  createdAt?: string;
  updatedAt?: string;
}
