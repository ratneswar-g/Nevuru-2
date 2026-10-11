import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../auth/index.ts';
import { AlertCircle, ServerCrash, WifiOff, X } from 'lucide-react';

export const GlobalErrorToast: React.FC = () => {
  const { errorToast, dismissErrorToast } = useAuth();
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const remainingTimeRef = useRef<number>(8000);

  const duration = 8000; // 8 seconds

  useEffect(() => {
    if (!errorToast) {
      setProgress(100);
      return;
    }

    remainingTimeRef.current = duration;
    setProgress(100);

    const interval = setInterval(() => {
      if (!isPaused) {
        remainingTimeRef.current -= 100;
        const pct = Math.max(0, (remainingTimeRef.current / duration) * 100);
        setProgress(pct);

        if (remainingTimeRef.current <= 0) {
          clearInterval(interval);
          dismissErrorToast();
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [errorToast?.id, isPaused, dismissErrorToast]);

  if (!errorToast) return null;

  const is404 = errorToast.status === 404;
  const is500 = errorToast.status >= 500;
  const isNetwork = errorToast.status === 0;

  const getBadgeStyle = () => {
    if (is404) return 'bg-amber-100 text-amber-800 border-amber-300';
    if (is500) return 'bg-rose-100 text-rose-800 border-rose-300';
    return 'bg-slate-100 text-slate-800 border-slate-300';
  };

  const getBorderAccent = () => {
    if (is404) return 'border-l-4 border-l-amber-500';
    if (is500) return 'border-l-4 border-l-rose-600';
    return 'border-l-4 border-l-indigo-600';
  };

  const getProgressBarColor = () => {
    if (is404) return 'bg-amber-500';
    if (is500) return 'bg-rose-600';
    return 'bg-indigo-600';
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-5 right-5 z-50 max-w-md w-full px-4 sm:px-0 pointer-events-auto transition-all duration-200"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl border border-slate-200/90 overflow-hidden ring-1 ring-black/5 ${getBorderAccent()}`}
      >
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {is404 && <AlertCircle className="w-5 h-5 text-amber-600" aria-hidden="true" />}
                {is500 && <ServerCrash className="w-5 h-5 text-rose-600" aria-hidden="true" />}
                {isNetwork && <WifiOff className="w-5 h-5 text-indigo-600" aria-hidden="true" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${getBadgeStyle()}`}
                  >
                    {errorToast.status > 0 ? `HTTP ${errorToast.status}` : 'NETWORK FAILURE'}
                  </span>
                  {errorToast.actionName && (
                    <span className="text-[11px] text-slate-500 font-medium truncate">
                      {errorToast.actionName}
                    </span>
                  )}
                </div>
                <h4 className="text-slate-900 font-semibold text-sm leading-snug">
                  {errorToast.title}
                </h4>
                <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                  {errorToast.message}
                </p>

                {errorToast.endpoint && (
                  <div className="mt-2.5 p-2 bg-slate-50 rounded-lg border border-slate-200 text-[11px] font-mono text-slate-700 break-all select-all">
                    <span className="text-slate-400 select-none">Path: </span>
                    {errorToast.endpoint}
                  </div>
                )}

                {errorToast.details && (
                  <p className="text-[11px] text-slate-600 mt-2 bg-amber-50/70 p-2 rounded border border-amber-200/60 leading-normal">
                    {errorToast.details}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={dismissErrorToast}
              aria-label="Dismiss error notification"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              {isPaused ? 'Timer paused (hovering)' : 'Auto-dismissing (8s)'}
            </span>
            <button
              onClick={dismissErrorToast}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 px-2.5 py-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        {/* Auto-dismiss progress bar */}
        <div className="h-1 bg-slate-100 w-full overflow-hidden">
          <div
            className={`h-full transition-all duration-100 ease-linear ${getProgressBarColor()}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
