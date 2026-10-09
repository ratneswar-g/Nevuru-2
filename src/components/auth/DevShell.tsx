import React, { useState } from 'react';
import { useAuth } from '../../auth/index.ts';
import { LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PatientPortal } from '../patient/PatientPortal.tsx';
import { CarePartnerPortal } from '../care-partner/CarePartnerPortal.tsx';
import { FamilyPortal } from '../family/FamilyPortal.tsx';
import { AdminPortal } from '../admin/AdminPortal.tsx';

export const DevShell: React.FC = () => {
  const { currentUser, currentSession, role, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (!currentUser || !role) {
    return null;
  }

  const isDevSession = Boolean(currentSession?.isDevelopmentSession);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);

      // Thoroughly clear all development session keys and credentials from storage
      if (typeof window !== 'undefined') {
        const keysToRemove = [
          'neravu_dev_auth_session',
          'neravu_auth_session',
          'neravu_active_session',
          'neravu_auth_token',
          'neravu_auth_user',
          'neravu_auth_session_id',
          'neravu_active_otp_challenge',
          'neravu_dev_otp_preview',
        ];

        keysToRemove.forEach((key) => {
          try {
            window.localStorage?.removeItem(key);
            window.sessionStorage?.removeItem(key);
          } catch {}
        });

        // Strip any residual prefixed storage keys
        try {
          if (window.sessionStorage) {
            Object.keys(window.sessionStorage)
              .filter((k) => k.startsWith('neravu_'))
              .forEach((k) => window.sessionStorage.removeItem(k));
          }
          if (window.localStorage) {
            Object.keys(window.localStorage)
              .filter((k) => k.startsWith('neravu_dev_') || k.startsWith('neravu_auth_'))
              .forEach((k) => window.localStorage.removeItem(k));
          }
        } catch {}
      }

      // Execute authoritative auth provider logout
      await logout();
    } catch (err) {
      console.error('Failed to logout cleanly:', err);
      // Fallback: force session clearing
      await logout().catch(() => {});
    } finally {
      setIsLoggingOut(false);
    }
  };

  const renderRolePortal = () => {
    switch (role) {
      case 'PATIENT':
        return <PatientPortal />;
      case 'CARE_PARTNER':
        return <CarePartnerPortal />;
      case 'FAMILY_CONTACT':
        return <FamilyPortal />;
      case 'ADMIN':
        return <AdminPortal />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Identity & Session Status Bar */}
      <header className="bg-slate-900 text-slate-200 px-4 py-2.5 text-xs border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-2.5 flex-wrap">
          {isDevSession ? (
            <span className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-md font-semibold uppercase tracking-wider text-[11px]">
              <ShieldAlert className="w-3.5 h-3.5" />
              Dev Mode Session
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2.5 py-1 rounded-md font-semibold uppercase tracking-wider text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified Server Session
            </span>
          )}
          <span className="text-slate-600 hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-white text-sm">{currentUser.name}</span>
            <span className="text-slate-400 font-mono text-xs">({currentUser.phone})</span>
          </div>
          <span className="bg-teal-950 text-teal-300 border border-teal-700/60 px-2 py-0.5 rounded text-xs font-mono font-medium">
            {role}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Prominent High-Visibility Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold px-4 py-1.5 rounded-lg border border-rose-400/40 shadow-sm hover:shadow-rose-600/30 transition-all focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer disabled:opacity-60 text-xs sm:text-sm"
            title="Clear all session data and return to login screen"
            aria-label="Log out of session"
          >
            {isLoggingOut ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <LogOut className="w-4 h-4 text-white" />
            )}
            <span>{isLoggingOut ? 'Logging out...' : 'Log Out'}</span>
          </button>
        </div>
      </header>

      {/* Dev Mode Banner with Quick Exit Link */}
      {isDevSession && (
        <div className="bg-amber-950/40 border-b border-amber-600/30 text-amber-200 px-4 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Active <strong>Development Persona Session</strong>. All actions are isolated to this session.
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-amber-300 hover:text-white font-medium underline transition-colors cursor-pointer text-xs"
          >
            Exit Development Mode &rarr;
          </button>
        </div>
      )}

      {/* Active Role Portal Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6">
        {renderRolePortal()}
      </main>
    </div>
  );
};
