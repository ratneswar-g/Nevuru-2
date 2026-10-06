import { UserRole } from '../domain/types/user.ts';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  email?: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
  createdAt?: string;
  isDevelopmentSession?: boolean;
}

export interface IAuthService {
  requestOtp(params: { phoneNumber: string }): Promise<any>;
  verifyOtp(params: { phoneNumber: string; referenceId?: string; code: string }): Promise<any>;
  register?(params: { phoneNumber: string; name: string; role: UserRole; referenceId: string }): Promise<any>;
  getSession?(): Promise<AuthSession | null>;
  logout(): Promise<void>;
  getCurrentUser?(): Promise<AuthUser | null>;
}

export interface IDevAuthService {
  getAvailableDevIdentities(): AuthUser[];
  getCurrentSession(): Promise<AuthSession>;
  getCurrentUser(): Promise<AuthUser>;
  loginAsDevRole(role: UserRole): Promise<AuthSession>;
  logout(): Promise<void> | void;
}
