import React, { useState } from 'react';
import { useAuth } from '../../auth/index.ts';
import { UserRole } from '../../domain/types/user.ts';
import { neravuApi } from '../../services/api-client.ts';
import {
  ShieldAlert,
  UserCheck,
  HeartHandshake,
  Users,
  ShieldCheck,
  Phone,
  KeyRound,
  UserPlus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Terminal,
} from 'lucide-react';

const ROLE_CONFIG: Record<
  UserRole,
  {
    label: string;
    description: string;
    icon: React.FC<{ className?: string }>;
    badgeColor: string;
  }
> = {
  PATIENT: {
    label: 'Patient / Senior',
    description: 'Book door-to-door hospital journeys and request Care Partner accompaniment.',
    icon: UserCheck,
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  CARE_PARTNER: {
    label: 'Care Partner',
    description: 'Accept assigned journeys, update milestones, and accompany patients.',
    icon: HeartHandshake,
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  FAMILY_CONTACT: {
    label: 'Family / Trusted Contact',
    description: 'Track linked patient journeys in real time and receive milestone updates.',
    icon: Users,
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  ADMIN: {
    label: 'Operations Admin',
    description: 'Monitor all active journeys, manage Care Partner verification, and handle escalations.',
    icon: ShieldCheck,
    badgeColor: 'bg-slate-200 text-slate-900 border-slate-300',
  },
};

type AuthStep = 'PHONE_ENTRY' | 'OTP_VERIFY' | 'REGISTRATION';

export const DevLoginScreen: React.FC = () => {
  const { availableDevIdentities, loginAsDevRole, requestOtp, verifyOtp, registerUser, isLoading } =
    useAuth();

  const isDevEnvironment =
    typeof import.meta !== 'undefined' && import.meta.env ? !import.meta.env.PROD : true;

  const [step, setStep] = useState<AuthStep>('PHONE_ENTRY');
  const [phoneNumber, setPhoneNumber] = useState<string>(isDevEnvironment ? '+919800000001' : '');
  const [referenceId, setReferenceId] = useState<string>('');
  const [otpCode, setOtpCode] = useState<string>('');
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(300);

  const [fullName, setFullName] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'PATIENT' | 'CARE_PARTNER' | 'FAMILY_CONTACT'>('PATIENT');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    setDevOtpPreview(null);

    try {
      const normalized = phoneNumber.trim();
      const result = await requestOtp(normalized);
      setReferenceId(result.referenceId);
      setExpiresInSeconds(result.expiresInSeconds);
      setOtpCode('');
      setStep('OTP_VERIFY');

      if (isDevEnvironment) {
        const preview = await neravuApi.getDevOtpPreview(result.referenceId);
        if (preview) {
          setDevOtpPreview(preview);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.userFriendlyMessage || err?.message || 'Failed to send verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const result = await verifyOtp({
        phoneNumber: phoneNumber.trim(),
        referenceId,
        code: otpCode.trim(),
      });

      if (result.requiresRegistration) {
        setStep('REGISTRATION');
      }
    } catch (err: any) {
      setErrorMessage(err?.userFriendlyMessage || err?.message || 'Invalid verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      await registerUser({
        phoneNumber: phoneNumber.trim(),
        name: fullName.trim(),
        role: selectedRole,
        referenceId,
      });
    } catch (err: any) {
      setErrorMessage(err?.userFriendlyMessage || err?.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-400">
              Neravu Healthcare Accompaniment Platform
            </span>
            <h1 className="text-2xl font-bold tracking-tight mt-0.5">
              Sign In to Neravu
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              End-to-end Care Partner accompaniment from home to hospital and safely back home.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-slate-300">
            <ShieldCheck className="w-4 h-4 text-teal-400" />
            <span>Server-Verified Session Auth</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left Column: Primary Phone OTP & Registration Flow */}
          <div className="lg:col-span-7 p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
                {step === 'PHONE_ENTRY' && <Phone className="w-5 h-5" />}
                {step === 'OTP_VERIFY' && <KeyRound className="w-5 h-5" />}
                {step === 'REGISTRATION' && <UserPlus className="w-5 h-5" />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {step === 'PHONE_ENTRY' && 'Phone Number Sign-In'}
                  {step === 'OTP_VERIFY' && 'Verify 6-Digit OTP Code'}
                  {step === 'REGISTRATION' && 'Complete Your Neravu Profile'}
                </h2>
                <p className="text-xs text-slate-500">
                  {step === 'PHONE_ENTRY' && 'Enter your E.164 mobile number to receive a one-time verification code.'}
                  {step === 'OTP_VERIFY' && `Verification code sent to ${phoneNumber} (valid for ${Math.ceil(expiresInSeconds / 60)} min).`}
                  {step === 'REGISTRATION' && `Phone ${phoneNumber} verified. Select your account role to continue.`}
                </p>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="mb-5 bg-red-50 border border-red-200 text-red-900 rounded-xl p-3.5 flex items-start gap-2.5 text-xs sm:text-sm"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {step === 'PHONE_ENTRY' && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div>
                  <label htmlFor="phone-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Mobile Phone Number (E.164 Format)
                  </label>
                  <input
                    id="phone-input"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+919845011111"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-500 mt-1.5">
                    Include country code (e.g. <code className="bg-slate-100 px-1 py-0.5 rounded">+919876543210</code>).
                  </p>
                </div>

                {/* Preset phone numbers helper - Development only */}
                {isDevEnvironment && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Quick-Fill Registered Phone Numbers
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableDevIdentities.map((identity) => {
                        const cleanPhone = identity.phone.replace(/[^\d+]/g, '');
                        return (
                          <button
                            key={identity.id}
                            type="button"
                            onClick={() => setPhoneNumber(cleanPhone)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              phoneNumber === cleanPhone
                                ? 'bg-teal-600 text-white border-teal-600 font-medium'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {identity.role}: {cleanPhone}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || isLoading}
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
                >
                  <span>{submitting ? 'Sending OTP...' : 'Send Verification Code'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {step === 'OTP_VERIFY' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {isDevEnvironment && devOtpPreview && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 text-amber-950 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Terminal className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <span className="font-bold uppercase tracking-wider block text-amber-900">
                          Development Console OTP Preview
                        </span>
                        <span className="text-amber-800">
                          Generated 6-digit code:{' '}
                          <code className="font-mono font-bold text-sm bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">
                            {devOtpPreview}
                          </code>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOtpCode(devOtpPreview)}
                      className="text-xs font-semibold bg-amber-900 text-white px-2.5 py-1.5 rounded-lg hover:bg-amber-800 shrink-0"
                    >
                      Autofill Code
                    </button>
                  </div>
                )}

                <div>
                  <label htmlFor="otp-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    6-Digit Verification Code
                  </label>
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('PHONE_ENTRY');
                      setErrorMessage(null);
                    }}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-medium"
                  >
                    Change Number
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || isLoading || otpCode.length !== 6}
                    className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{submitting ? 'Verifying...' : 'Verify & Continue'}</span>
                  </button>
                </div>
              </form>
            )}

            {step === 'REGISTRATION' && (
              <form onSubmit={handleRegisterUser} className="space-y-4">
                <div>
                  <label htmlFor="name-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="name-input"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g., Meera Krishnan"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Account Role
                  </label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {(['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT'] as const).map((roleOption) => {
                      const cfg = ROLE_CONFIG[roleOption];
                      const Icon = cfg.icon;
                      const isSelected = selectedRole === roleOption;
                      return (
                        <button
                          key={roleOption}
                          type="button"
                          onClick={() => setSelectedRole(roleOption)}
                          className={`text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                            isSelected
                              ? 'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className={`p-2 rounded-lg border ${cfg.badgeColor}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{cfg.label}</div>
                            <div className="text-xs text-slate-600 mt-0.5">{cfg.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Note: Operations Admin accounts cannot be self-registered and require controlled server-side provisioning.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={submitting || isLoading || fullName.trim().length < 2}
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{submitting ? 'Creating Account...' : 'Complete Registration & Sign In'}</span>
                </button>
              </form>
            )}
          </div>

          {/* Right Column: Non-Production Development Persona Switcher */}
          {isDevEnvironment && (
            <div className="lg:col-span-5 p-6 sm:p-8 bg-slate-50/70">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2.5 text-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold block">Development Quick-Login (Non-Production)</span>
                  Instantly provision a server-verified session for a pre-seeded role persona. Disabled in production.
                </div>
              </div>

              <div className="space-y-2.5">
                {availableDevIdentities.map((identity) => {
                  const config = ROLE_CONFIG[identity.role];
                  const Icon = config.icon;
                  return (
                    <button
                      key={identity.id}
                      type="button"
                      disabled={isLoading || submitting}
                      onClick={() => loginAsDevRole(identity.role)}
                      className="w-full text-left p-3.5 rounded-xl bg-white border border-slate-200 hover:border-teal-600 hover:bg-teal-50/30 transition-all group flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg border shrink-0 ${config.badgeColor}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span
                            className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${config.badgeColor}`}
                          >
                            {config.label}
                          </span>
                          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-teal-900 truncate mt-0.5">
                            {identity.name}
                          </h3>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {identity.phone}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
