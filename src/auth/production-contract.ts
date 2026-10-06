import { AuthSession, AuthUser, IAuthService } from './types.ts';
import { NeravuApiClient, neravuApi, PROD_AUTH_STORAGE_KEY } from '../services/api-client.ts';

export interface OtpRequestParams {
  phoneNumber: string; // E.164 formatted string
}

export interface OtpRequestResult {
  success: boolean;
  referenceId: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
}

export interface OtpVerificationParams {
  phoneNumber: string;
  referenceId: string;
  code: string;
}

export interface OtpVerificationFullResult {
  success: boolean;
  requiresRegistration: boolean;
  session?: AuthSession;
  user?: AuthUser;
  phoneNumber?: string;
  referenceId?: string;
}

export interface RegistrationParams {
  phoneNumber: string;
  name: string;
  role: 'PATIENT' | 'CARE_PARTNER' | 'FAMILY_CONTACT';
  referenceId?: string;
}

/**
 * Production Authentication Contract.
 * Outlines the interface for SMS/OTP phone verification and server-authoritative sessions.
 */
export interface IProductionOTPAuthService extends IAuthService {
  /**
   * Dispatches an SMS OTP to the user's verified phone number.
   * Throws if provider quota is exceeded or number format is invalid.
   */
  requestOtp(params: OtpRequestParams): Promise<OtpRequestResult>;

  /**
   * Verifies the 6-digit OTP code against the active reference ID.
   * Returns an authoritative authenticated session.
   */
  verifyOtp(params: OtpVerificationParams): Promise<AuthSession>;

  /**
   * Verifies the 6-digit OTP code and returns whether first-time registration is required.
   */
  verifyOtpChallenge?(params: OtpVerificationParams): Promise<OtpVerificationFullResult>;

  /**
   * Completes initial profile setup during first-time phone sign-up.
   */
  registerUser(params: RegistrationParams): Promise<AuthUser>;

  /**
   * Completes initial profile setup and returns both the user and server session.
   */
  registerNewUser?(params: RegistrationParams): Promise<{ user: AuthUser; session: AuthSession }>;
}

/**
 * Production server-backed OTP & session authentication client.
 */
export class ProductionOtpAuthService implements IProductionOTPAuthService {
  private apiClient: NeravuApiClient;
  private inMemorySession: AuthSession | null = null;

  constructor(apiClient: NeravuApiClient = neravuApi) {
    this.apiClient = apiClient;
  }

  private saveSession(session: AuthSession | null): void {
    this.inMemorySession = session;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (session) {
          window.localStorage.setItem(PROD_AUTH_STORAGE_KEY, JSON.stringify(session));
        } else {
          window.localStorage.removeItem(PROD_AUTH_STORAGE_KEY);
        }
      }
    } catch {
      // Non-browser environment
    }
  }

  private readStoredSession(): AuthSession | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(PROD_AUTH_STORAGE_KEY);
        if (raw) {
          return JSON.parse(raw) as AuthSession;
        }
      }
    } catch {
      // Non-browser environment
    }
    return this.inMemorySession;
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    const stored = this.readStoredSession();
    if (!stored || !stored.token) {
      return null;
    }

    try {
      const verified = await this.apiClient.getSession();
      const updatedSession: AuthSession = {
        ...verified.session,
        token: stored.token,
      };
      this.saveSession(updatedSession);
      return updatedSession;
    } catch {
      this.saveSession(null);
      return null;
    }
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = await this.getCurrentSession();
    return session?.user || null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.getCurrentSession();
  }

  async requestOtp(params: OtpRequestParams): Promise<OtpRequestResult> {
    return this.apiClient.requestOtp(params.phoneNumber);
  }

  async verifyOtpChallenge(params: OtpVerificationParams): Promise<OtpVerificationFullResult> {
    const result = await this.apiClient.verifyOtp(params);
    if (!result.requiresRegistration && result.session) {
      this.saveSession(result.session);
    }
    return result;
  }

  async verifyOtp(params: OtpVerificationParams): Promise<AuthSession> {
    const result = await this.verifyOtpChallenge(params);
    if (result.requiresRegistration || !result.session) {
      throw new Error('REGISTRATION_REQUIRED: Phone verified, user registration required.');
    }
    return result.session;
  }

  async registerNewUser(params: RegistrationParams): Promise<{ user: AuthUser; session: AuthSession }> {
    const result = await this.apiClient.registerUser(params);
    this.saveSession(result.session);
    return { user: result.user, session: result.session };
  }

  async registerUser(params: RegistrationParams): Promise<AuthUser> {
    const { user } = await this.registerNewUser(params);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await this.apiClient.logoutSession();
    } catch {
      // Ensure local state is cleared even if network or token already expired
    } finally {
      this.saveSession(null);
    }
  }
}
