import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { AuthSession, AuthUser, IDevAuthService } from './types.ts';
import { DevelopmentAuthProvider } from './development-auth.ts';
import {
  ProductionOtpAuthService,
  OtpRequestResult,
  OtpVerificationParams,
  OtpVerificationFullResult,
  RegistrationParams,
} from './production-contract.ts';
import { UserRole } from '../domain/types/user.ts';
import {
  neravuApi,
  PROD_AUTH_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  ACTIVE_OTP_CHALLENGE_STORAGE_KEY,
} from '../services/api-client.ts';

export interface ActiveOtpChallenge {
  phoneNumber: string;
  referenceId: string;
  expiresInSeconds: number;
  expiresAt: number;
  retryAfterSeconds?: number;
}

export interface AuthContextValue {
  currentUser: AuthUser | null;
  currentSession: AuthSession | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  availableDevIdentities: AuthUser[];
  loginAsDevRole: (role: UserRole) => Promise<void>;
  requestOtp: (phoneNumber: string) => Promise<OtpRequestResult>;
  verifyOtp: (params: OtpVerificationParams) => Promise<OtpVerificationFullResult>;
  registerUser: (params: RegistrationParams) => Promise<AuthUser>;
  logout: () => Promise<void>;
  activeOtpChallenge: ActiveOtpChallenge | null;
  devOtpCode: string | null;
  clearActiveOtpChallenge: () => void;
  fetchDevOtp: (referenceId: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Default singleton auth services for app lifecycle
export const defaultDevAuthService: IDevAuthService = new DevelopmentAuthProvider();
export const defaultProductionAuthService = new ProductionOtpAuthService(neravuApi);

interface AuthProviderProps {
  children: React.ReactNode;
  authService?: IDevAuthService;
  productionAuthService?: ProductionOtpAuthService;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  authService = defaultDevAuthService,
  productionAuthService = defaultProductionAuthService,
}) => {
  const [currentSession, setCurrentSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Active OTP challenge client state
  const [activeOtpChallenge, setActiveOtpChallenge] = useState<ActiveOtpChallenge | null>(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const raw = window.sessionStorage.getItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ActiveOtpChallenge;
          if (parsed && typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) {
            return parsed;
          } else {
            window.sessionStorage.removeItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
          }
        }
      }
    } catch {
      // Non-browser or storage restricted
    }
    return null;
  });

  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);

  // One-shot restoration watcher on page reloads (only runs once on mount)
  useEffect(() => {
    let mounted = true;
    const isDev =
      typeof import.meta !== 'undefined' && import.meta.env
        ? !import.meta.env.PROD
        : process.env.NODE_ENV !== 'production';

    if (activeOtpChallenge && activeOtpChallenge.expiresAt > Date.now() && isDev && !devOtpCode) {
      neravuApi
        .getDevOtpPreview(activeOtpChallenge.referenceId)
        .then((code) => {
          if (mounted && code) {
            setDevOtpCode(code);
          }
        })
        .catch(() => {});
    }

    return () => {
      mounted = false;
    };
  }, []);

  // Periodic expiration watcher: clear dev OTP when expired
  useEffect(() => {
    if (!activeOtpChallenge) return;

    const interval = setInterval(() => {
      if (Date.now() >= activeOtpChallenge.expiresAt) {
        setDevOtpCode(null);
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.removeItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
          }
        } catch {}
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeOtpChallenge]);

  // Initialize and verify session on mount
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        // 1. Attempt server-authoritative session verification for real verified sessions only
        const prodSession = await productionAuthService.getCurrentSession();
        if (prodSession && !prodSession.isDevelopmentSession) {
          if (mounted) {
            setCurrentSession(prodSession);
          }
          return;
        }

        // If stored session is a development persona session, clear it so normal startup starts unauthenticated
        if (prodSession?.isDevelopmentSession) {
          await productionAuthService.logout().catch(() => {});
        }

        // Normal application startup must NOT automatically enter a development persona.
        if (mounted) {
          setCurrentSession(null);
        }
      } catch (err) {
        console.error('Failed to initialize session:', err);
        if (mounted) {
          setCurrentSession(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();
    return () => {
      mounted = false;
    };
  }, [authService, productionAuthService]);

  // Listen for server 401 UNAUTHENTICATED events to clear expired/revoked sessions immediately
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnauthenticated = () => {
      setCurrentSession(null);
    };

    window.addEventListener('neravu-auth-unauthenticated', handleUnauthenticated);
    return () => {
      window.removeEventListener('neravu-auth-unauthenticated', handleUnauthenticated);
    };
  }, []);

  const loginAsDevRole = useCallback(
    async (role: UserRole) => {
      setIsLoading(true);
      try {
        // Explicit developer action: login as requested dev role
        const localDevSession = await authService.loginAsDevRole(role);

        // Also request a real server-backed session token when backend is reachable
        try {
          const serverRes = await neravuApi.devLogin(role);
          if (serverRes?.session) {
            // Keep in-memory for this testing session without persisting across normal browser restarts
            setCurrentSession(serverRes.session);
            return;
          }
        } catch {
          // Backend unreachable or in unit test environment — use localDevSession
        }

        setCurrentSession(localDevSession);
      } finally {
        setIsLoading(false);
      }
    },
    [authService]
  );

  const requestOtp = useCallback(
    async (phoneNumber: string): Promise<OtpRequestResult> => {
      setDevOtpCode(null);
      const result = await productionAuthService.requestOtp({ phoneNumber });

      const expiresIn = result.expiresInSeconds || 300;
      const challenge: ActiveOtpChallenge = {
        phoneNumber: phoneNumber.trim(),
        referenceId: result.referenceId,
        expiresInSeconds: expiresIn,
        expiresAt: Date.now() + expiresIn * 1000,
        retryAfterSeconds: result.retryAfterSeconds,
      };

      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY, JSON.stringify(challenge));
        }
      } catch {}

      const isDev =
        typeof import.meta !== 'undefined' && import.meta.env
          ? !import.meta.env.PROD
          : process.env.NODE_ENV !== 'production';

      let resolvedDevOtp: string | null = null;
      if (isDev) {
        try {
          resolvedDevOtp = await neravuApi.getDevOtpPreview(result.referenceId);
        } catch {
          resolvedDevOtp = null;
        }
      }

      // Authoritative single-flow exposure: set challenge and devOtpCode simultaneously
      setActiveOtpChallenge(challenge);
      setDevOtpCode(resolvedDevOtp);

      return result;
    },
    [productionAuthService]
  );

  const verifyOtp = useCallback(
    async (params: OtpVerificationParams): Promise<OtpVerificationFullResult> => {
      const result = await productionAuthService.verifyOtpChallenge(params);
      if (result.success) {
        setActiveOtpChallenge(null);
        setDevOtpCode(null);
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.removeItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
          }
        } catch {}
      }
      if (!result.requiresRegistration && result.session) {
        setCurrentSession(result.session);
      }
      return result;
    },
    [productionAuthService]
  );

  const clearActiveOtpChallenge = useCallback(() => {
    setActiveOtpChallenge(null);
    setDevOtpCode(null);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
      }
    } catch {}
  }, []);

  const fetchDevOtp = useCallback(async (refId: string): Promise<string | null> => {
    const isDev =
      typeof import.meta !== 'undefined' && import.meta.env
        ? !import.meta.env.PROD
        : process.env.NODE_ENV !== 'production';
    if (!isDev || !refId) return null;
    try {
      const preview = await neravuApi.getDevOtpPreview(refId);
      if (preview) {
        setDevOtpCode(preview);
      }
      return preview;
    } catch {
      return null;
    }
  }, []);

  const registerUser = useCallback(
    async (params: RegistrationParams): Promise<AuthUser> => {
      setIsLoading(true);
      try {
        const { user, session } = await productionAuthService.registerNewUser(params);
        setCurrentSession(session);
        return user;
      } finally {
        setIsLoading(false);
      }
    },
    [productionAuthService]
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.allSettled([productionAuthService.logout(), authService.logout()]);
      if (typeof window !== 'undefined') {
        if (window.localStorage) {
          window.localStorage.removeItem(PROD_AUTH_STORAGE_KEY);
          window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
          window.localStorage.removeItem('neravu_dev_auth_session');
          window.localStorage.removeItem('neravu_active_session');
          window.localStorage.removeItem('neravu_auth_token');
          window.localStorage.removeItem('neravu_auth_user');
          window.localStorage.removeItem('neravu_auth_session_id');
        }
        if (window.sessionStorage) {
          window.sessionStorage.removeItem(ACTIVE_OTP_CHALLENGE_STORAGE_KEY);
          window.sessionStorage.removeItem('neravu_dev_otp_preview');
        }
      }
      setActiveOtpChallenge(null);
      setDevOtpCode(null);
      setCurrentSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [authService, productionAuthService]);

  const currentUser = currentSession?.user || null;
  const role = currentUser?.role || null;
  const isAuthenticated = !!currentUser;
  const availableDevIdentities = useMemo(() => authService.getAvailableDevIdentities(), [authService]);

  const value: AuthContextValue = {
    currentUser,
    currentSession,
    role,
    isAuthenticated,
    isLoading,
    availableDevIdentities,
    loginAsDevRole,
    requestOtp,
    verifyOtp,
    registerUser,
    logout,
    activeOtpChallenge,
    devOtpCode,
    clearActiveOtpChallenge,
    fetchDevOtp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
