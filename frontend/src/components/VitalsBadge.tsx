import React from 'react';
import { Heart, Activity, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface VitalsBadgeProps {
  vitals?: {
    hr?: number | null;
    spo2?: number | null;
    valid?: boolean;
    ts?: string;
    isStale?: boolean;
    disclaimer?: string;
  } | null;
  className?: string;
}

export function VitalsBadge({ vitals, className }: VitalsBadgeProps) {
  if (!vitals || (vitals.hr == null && vitals.spo2 == null)) {
    return (
      <div className={cn('p-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center justify-between', className)}>
        <span className="flex items-center gap-1.5 font-medium">
          <Activity className="w-3.5 h-3.5 text-slate-400" />
          <span>Vitals Sensor Connecting...</span>
        </span>
        <span className="text-[10px] uppercase font-mono tracking-tight text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
          non-clinical / demo-grade
        </span>
      </div>
    );
  }

  const isStale = vitals.isStale ?? false;
  const isValid = vitals.valid ?? true;

  return (
    <div
      className={cn(
        'p-3.5 rounded-2xl border transition-all duration-300',
        isStale
          ? 'bg-amber-50/70 border-amber-200'
          : !isValid
          ? 'bg-rose-50/70 border-rose-200'
          : 'bg-white border-slate-200 shadow-xs',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                isStale ? 'bg-amber-400' : 'bg-rose-400'
              )}
            />
            <span
              className={cn(
                'relative inline-flex rounded-full h-2 w-2',
                isStale ? 'bg-amber-500' : 'bg-rose-500'
              )}
            />
          </span>
          <span className="text-xs font-bold text-slate-900 tracking-tight">
            MAX30102 Live Telemetry
          </span>
        </div>

        {isStale ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-amber-100 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3" />
            STALE (&gt;30s)
          </span>
        ) : (
          <span className="text-[10px] uppercase font-mono tracking-tight text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
            non-clinical / demo-grade
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {/* Heart Rate */}
        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-rose-50/60 border border-rose-100">
          <div className="p-1.5 rounded-xl bg-white text-rose-500 shadow-2xs border border-rose-100">
            <Heart className="w-4 h-4 animate-pulse-heart" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Heart Rate</div>
            <div className="text-base font-mono font-extrabold text-slate-900 leading-none mt-0.5">
              {vitals.hr ?? '--'} <span className="text-[10px] font-normal text-slate-400">BPM</span>
            </div>
          </div>
        </div>

        {/* SpO2 */}
        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-sky-50/60 border border-sky-100">
          <div className="p-1.5 rounded-xl bg-white text-sky-500 shadow-2xs border border-sky-100">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Blood Oxygen</div>
            <div className="text-base font-mono font-extrabold text-slate-900 leading-none mt-0.5">
              {vitals.spo2 ?? '--'}<span className="text-[10px] font-normal text-slate-400">%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
