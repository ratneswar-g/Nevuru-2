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
import { neravuApi, PROD_AUTH_STORAGE_KEY, DEV_AUTH_STORAGE_KEY } from '../services/api-client.ts';

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

  // Initialize and verify session on mount
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        // 1. Attempt server-authoritative session verification first
        const prodSession = await productionAuthService.getCurrentSession();
        if (prodSession) {
          if (mounted) {
            setCurrentSession(prodSession);
          }
          return;
        }

        // 2. In non-production, fall back to development session if present
        const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
        if (!isProd) {
          const devSession = await authService.getCurrentSession();
          if (mounted) {
            setCurrentSession(devSession);
          }
        }
      } catch (err) {
        console.error('Failed to initialize session:', err);
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
        // First set local dev session via authService for immediate consistency
        const localDevSession = await authService.loginAsDevRole(role);

        // Also request a real server-backed session token when backend is reachable
        try {
          const serverRes = await neravuApi.devLogin(role);
          if (serverRes?.session) {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(PROD_AUTH_STORAGE_KEY, JSON.stringify(serverRes.session));
            }
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
      return productionAuthService.requestOtp({ phoneNumber });
    },
    [productionAuthService]
  );

  const verifyOtp = useCallback(
    async (params: OtpVerificationParams): Promise<OtpVerificationFullResult> => {
      setIsLoading(true);
      try {
        const result = await productionAuthService.verifyOtpChallenge(params);
        if (!result.requiresRegistration && result.session) {
          setCurrentSession(result.session);
        }
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [productionAuthService]
  );

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
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(PROD_AUTH_STORAGE_KEY);
        window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
      }
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
