import React from 'react';
import { useAuth } from '../../auth/index.ts';
import { UserRole } from '../../domain/types/user.ts';
import { LogOut, ShieldAlert, ShieldCheck, RefreshCw } from 'lucide-react';
import { PatientPortal } from '../patient/PatientPortal.tsx';
import { CarePartnerPortal } from '../care-partner/CarePartnerPortal.tsx';
import { FamilyPortal } from '../family/FamilyPortal.tsx';
import { AdminPortal } from '../admin/AdminPortal.tsx';

const ROLES: UserRole[] = ['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'];

export const DevShell: React.FC = () => {
  const { currentUser, currentSession, role, loginAsDevRole, logout } = useAuth();

  if (!currentUser || !role) {
    return null;
  }

  const isDevSession = Boolean(currentSession?.isDevelopmentSession);
  const isDevEnvironment =
    typeof import.meta !== 'undefined' && import.meta.env ? !import.meta.env.PROD : true;

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
      <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          {isDevSession ? (
            <span className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">
              <ShieldAlert className="w-3.5 h-3.5" />
              Dev Mode Session
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified Server Session
            </span>
          )}
          <span className="text-slate-400 hidden sm:inline">|</span>
          <span className="font-medium text-white">{currentUser.name}</span>
          <span className="text-slate-400 font-mono">({currentUser.phone})</span>
          <span className="bg-teal-900/60 text-teal-300 border border-teal-700/50 px-2 py-0.5 rounded font-mono">
            {role}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isDevEnvironment && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 hidden md:inline">Switch Role:</span>
              <select
                aria-label="Switch Role"
                value={role}
                onChange={(e) => loginAsDevRole(e.target.value as UserRole)}
                className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-teal-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={logout}
            className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded border border-slate-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Active Role Portal Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6">
        {renderRolePortal()}
      </main>
    </div>
  );
};
