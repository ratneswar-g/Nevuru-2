import React, { useState, useEffect } from 'react';
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
  ChevronDown,
  ChevronUp,
  Sparkles,
  Lock,
  Activity,
  Heart,
  Shield,
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
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CARE_PARTNER: {
    label: 'Care Partner',
    description: 'Accept assigned journeys, update milestones, and accompany patients safely.',
    icon: HeartHandshake,
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  FAMILY_CONTACT: {
    label: 'Family / Trusted Contact',
    description: 'Track linked patient journeys in real time and receive milestone updates.',
    icon: Users,
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  ADMIN: {
    label: 'Operations Admin',
    description: 'Monitor active journeys, manage Care Partner verification, and handle escalations.',
    icon: ShieldCheck,
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-200',
  },
};

type AuthStep = 'PHONE_ENTRY' | 'OTP_VERIFY' | 'REGISTRATION';

export const DevLoginScreen: React.FC = () => {
  const {
    availableDevIdentities,
    loginAsDevRole,
    requestOtp,
    verifyOtp,
    registerUser,
    isLoading,
    activeOtpChallenge,
    devOtpCode,
    clearActiveOtpChallenge,
    fetchDevOtp,
  } = useAuth();

  const isDevEnvironment =
    typeof import.meta !== 'undefined' && import.meta.env ? !import.meta.env.PROD : true;

  const [step, setStep] = useState<AuthStep>(() => {
    if (activeOtpChallenge && activeOtpChallenge.expiresAt > Date.now()) {
      return 'OTP_VERIFY';
    }
    return 'PHONE_ENTRY';
  });
  const [phoneNumber, setPhoneNumber] = useState<string>(() => {
    return activeOtpChallenge?.phoneNumber || '';
  });
  const [referenceId, setReferenceId] = useState<string>(() => {
    return activeOtpChallenge?.referenceId || '';
  });
  const [otpCode, setOtpCode] = useState<string>('');

  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (activeOtpChallenge) {
      return Math.max(0, Math.ceil((activeOtpChallenge.expiresAt - Date.now()) / 1000));
    }
    return 300;
  });

  const [fullName, setFullName] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'PATIENT' | 'CARE_PARTNER' | 'FAMILY_CONTACT'>('PATIENT');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showDevPanel, setShowDevPanel] = useState<boolean>(false);

  // Synchronize step and referenceId on initial remount if active challenge was loaded from storage
  useEffect(() => {
    if (activeOtpChallenge && activeOtpChallenge.expiresAt > Date.now()) {
      setPhoneNumber(activeOtpChallenge.phoneNumber);
      setReferenceId(activeOtpChallenge.referenceId);
      if (step === 'PHONE_ENTRY') {
        setStep('OTP_VERIFY');
      }
    }
  }, [activeOtpChallenge, step]);

  // Countdown timer effect
  useEffect(() => {
    if (step !== 'OTP_VERIFY' || !activeOtpChallenge) return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((activeOtpChallenge.expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step, activeOtpChallenge]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const normalized = phoneNumber.trim();
      const result = await requestOtp(normalized);
      setReferenceId(result.referenceId);
      setOtpCode('');
      setStep('OTP_VERIFY');
    } catch (err: any) {
      setErrorMessage(err?.userFriendlyMessage || err?.message || 'Failed to send verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const normalized = phoneNumber.trim();
      const result = await requestOtp(normalized);
      setReferenceId(result.referenceId);
      setOtpCode('');
    } catch (err: any) {
      setErrorMessage(err?.userFriendlyMessage || err?.message || 'Failed to resend verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeNumber = () => {
    clearActiveOtpChallenge();
    setStep('PHONE_ENTRY');
    setOtpCode('');
    setErrorMessage(null);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const result = await verifyOtp({
        phoneNumber: phoneNumber.trim(),
        referenceId: referenceId || activeOtpChallenge?.referenceId || '',
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/20 to-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden transition-all duration-300">
        
        {/* Brand Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-teal-950 text-white px-6 sm:px-8 py-7 relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-teal-500/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-400 shadow-inner">
                <Heart className="w-6 h-6 fill-teal-400/20 text-teal-400" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-teal-400">
                  Neravu Healthcare
                </span>
                <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
                  Secure Patient Accompaniment
                </h1>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-xs text-slate-200">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
              <span>Encrypted Session</span>
            </div>
          </div>
          <p className="text-slate-300 text-xs sm:text-sm mt-3 relative z-10 leading-relaxed">
            Door-to-door compassionate accompaniment from home to hospital and safely back.
          </p>
        </div>

        {/* Main Form Content */}
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2.5 rounded-xl bg-teal-50 text-teal-700 border border-teal-100">
              {step === 'PHONE_ENTRY' && <Phone className="w-5 h-5 text-teal-600" />}
              {step === 'OTP_VERIFY' && <KeyRound className="w-5 h-5 text-teal-600" />}
              {step === 'REGISTRATION' && <UserPlus className="w-5 h-5 text-teal-600" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                {step === 'PHONE_ENTRY' && 'Sign In with Mobile Number'}
                {step === 'OTP_VERIFY' && 'Enter Verification Code'}
                {step === 'REGISTRATION' && 'Complete Your Profile'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {step === 'PHONE_ENTRY' && 'Enter your registered mobile number for instant secure access.'}
                {step === 'OTP_VERIFY' && `6-digit code sent to ${phoneNumber} (valid for ${Math.ceil(secondsLeft / 60)}m).`}
                {step === 'REGISTRATION' && `Number ${phoneNumber} verified successfully. Please choose your role.`}
              </p>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-6 bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm shadow-sm animate-fadeIn"
            >
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {step === 'PHONE_ENTRY' && (
            <form onSubmit={handleRequestOtp} className="space-y-5">
              <div>
                <label htmlFor="phone-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Mobile Phone Number (E.164)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    id="phone-input"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+919845011111"
                    required
                    className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/50 text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white transition-all shadow-2xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1">
                  <span>Example format:</span>
                  <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">+919876543210</code>
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || isLoading}
                className="w-full bg-teal-600 hover:bg-teal-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 text-sm shadow-md shadow-teal-600/20 cursor-pointer"
              >
                <span>{submitting ? 'Sending Code...' : 'Send Verification Code'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {step === 'OTP_VERIFY' && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="otp-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    6-Digit OTP Code
                  </label>
                  <span className={`text-xs font-mono font-medium ${secondsLeft < 30 ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                    {secondsLeft > 0 ? (
                      `Expires in ${Math.floor(secondsLeft / 60)}m ${String(secondsLeft % 60).padStart(2, '0')}s`
                    ) : (
                      <span className="text-rose-600 font-semibold">Expired</span>
                    )}
                  </span>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    disabled={secondsLeft === 0}
                    required
                    className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 text-slate-900 font-mono text-xl tracking-[0.3em] text-center font-bold focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white disabled:opacity-50 transition-all shadow-2xs"
                  />
                </div>
              </div>

              {/* Development OTP Banner - Clearly labelled development-only message */}
              {isDevEnvironment && devOtpCode && secondsLeft > 0 && (
                <div
                  data-testid="development-otp-banner"
                  className="bg-amber-50/95 border-2 border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 shadow-xs animate-fadeIn"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0">
                      <Terminal className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-900 block">
                        DEVELOPMENT OTP
                      </span>
                      <span className="text-[11px] text-amber-800 font-medium">
                        Use the actual generated development OTP
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span
                      data-testid="dev-otp-code"
                      className="font-mono font-black text-xl tracking-[0.25em] bg-white px-3.5 py-1.5 rounded-xl border-2 border-amber-400 text-amber-950 shadow-inner select-all"
                    >
                      {devOtpCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOtpCode(devOtpCode)}
                      className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 bg-amber-200/60 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                      title="Auto-fill verification code"
                    >
                      Auto-Fill
                    </button>
                  </div>
                </div>
              )}

              {/* Expired OTP Message */}
              {secondsLeft === 0 && (
                <div
                  role="alert"
                  className="bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm shadow-sm animate-fadeIn"
                >
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-semibold text-rose-950">Verification Code Expired</p>
                    <p className="text-rose-800 text-xs mt-0.5">
                      The verification code for {phoneNumber} has expired. Please request a new code.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-0.5 text-slate-500">
                <button
                  type="button"
                  onClick={handleChangeNumber}
                  className="text-teal-700 hover:text-teal-800 font-medium underline underline-offset-2 cursor-pointer"
                >
                  Change phone number
                </button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={submitting}
                  className="text-slate-600 hover:text-slate-900 font-medium underline underline-offset-2 disabled:opacity-40 cursor-pointer"
                >
                  {submitting ? 'Sending...' : 'Request new code'}
                </button>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleChangeNumber}
                  className="px-5 py-3 rounded-2xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold transition-colors cursor-pointer"
                >
                  Change Number
                </button>
                <button
                  type="submit"
                  disabled={submitting || isLoading || otpCode.length !== 6 || secondsLeft === 0}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 text-sm shadow-md shadow-teal-600/20 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? 'Verifying...' : 'Verify & Continue'}</span>
                </button>
              </div>
            </form>
          )}

          {step === 'REGISTRATION' && (
            <form onSubmit={handleRegisterUser} className="space-y-5">
              <div>
                <label htmlFor="name-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Full Legal Name
                </label>
                <input
                  id="name-input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g., Meera Krishnan"
                  required
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/50 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white transition-all shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
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
                        className={`text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3.5 cursor-pointer ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/60 ring-2 ring-teal-600/20 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className={`p-2.5 rounded-xl border ${cfg.badgeColor} shrink-0 mt-0.5`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-900">{cfg.label}</div>
                          <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{cfg.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-2 italic">
                  Note: Operations Admin accounts require administrative provisioning.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || isLoading || fullName.trim().length < 2}
                className="w-full bg-teal-600 hover:bg-teal-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 text-sm shadow-md shadow-teal-600/20 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'Setting Up...' : 'Complete Registration & Sign In'}</span>
              </button>
            </form>
          )}

          {/* Trust Badges Footer */}
          <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-3 gap-3 text-center">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
              <Shield className="w-4 h-4 text-teal-600 mb-1" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">CARE PARTNER COMPLIANCE</span>
              <span className="text-[10px] text-slate-500 mt-0.5">Document & Verification</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
              <Activity className="w-4 h-4 text-teal-600 mb-1" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">LIVE TRACKING</span>
              <span className="text-[10px] text-slate-500 mt-0.5">Real-Time GPS & ETA</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
              <Lock className="w-4 h-4 text-teal-600 mb-1" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">SECURE JOURNEY</span>
              <span className="text-[10px] text-slate-500 mt-0.5">Privacy & Emergency Support</span>
            </div>
          </div>

          {/* Development Testing Quick Panel - Explicit Test Action Only */}
          {isDevEnvironment && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDevPanel((prev) => !prev)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-amber-600" />
                  <span>Developer Persona Testing (Dev Mode Only)</span>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                    {showDevPanel ? 'Hide' : 'Show'}
                  </span>
                </button>
              </div>
              {showDevPanel && (
                <div className="mt-3 p-3 bg-amber-50/60 border border-amber-200/80 rounded-2xl animate-fadeIn">
                  <p className="text-[11px] text-amber-900 mb-2 font-medium">
                    Explicit test action: Select a role persona to test workflows directly.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => loginAsDevRole(role)}
                        disabled={isLoading || submitting}
                        className="px-2.5 py-2 text-xs font-semibold rounded-xl bg-white border border-amber-300 text-slate-800 hover:bg-amber-100/60 active:scale-95 transition-all text-center shadow-2xs cursor-pointer"
                      >
                        {role === 'CARE_PARTNER' ? 'Partner' : role === 'FAMILY_CONTACT' ? 'Family' : role === 'PATIENT' ? 'Patient' : 'Admin'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
