import React, { useState } from 'react';
import { Plus, Minus, Bed, ShieldAlert, Activity, Clock } from 'lucide-react';
import { formatTime } from '../lib/utils.js';

interface BedInfo {
  total: number;
  available: number;
  updatedAt: string;
}

interface BedManagementProps {
  beds: Record<string, BedInfo>;
  onUpdateBed: (bedType: 'ER' | 'ICU' | 'General', delta: number) => Promise<void>;
  isLoading?: boolean;
}

export function BedManagementWidget({ beds, onUpdateBed, isLoading = false }: BedManagementProps) {
  const [updatingType, setUpdatingType] = useState<string | null>(null);

  const handleAdjust = async (type: 'ER' | 'ICU' | 'General', delta: number) => {
    try {
      setUpdatingType(type);
      await onUpdateBed(type, delta);
    } finally {
      setUpdatingType(null);
    }
  };

  const bedTypes: Array<{
    type: 'ER' | 'ICU' | 'General';
    label: string;
    sub: string;
    icon: typeof Bed;
    accent: string;
    badgeBg: string;
    cardBg: string;
    barColor: string;
  }> = [
    {
      type: 'ER',
      label: 'Emergency Resus (ER)',
      sub: 'Immediate stabilization',
      icon: Activity,
      accent: 'text-amber-800',
      badgeBg: 'bg-amber-100 text-amber-800 border-amber-200',
      cardBg: 'bg-amber-50/60 border-amber-200/70',
      barColor: 'bg-amber-500'
    },
    {
      type: 'ICU',
      label: 'Intensive Care (ICU)',
      sub: 'Ventilators & Level 1',
      icon: ShieldAlert,
      accent: 'text-rose-800',
      badgeBg: 'bg-rose-100 text-rose-800 border-rose-200',
      cardBg: 'bg-rose-50/60 border-rose-200/70',
      barColor: 'bg-rose-500'
    },
    {
      type: 'General',
      label: 'General Ward',
      sub: 'Step-down & recovery',
      icon: Bed,
      accent: 'text-emerald-800',
      badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      cardBg: 'bg-emerald-50/60 border-emerald-200/70',
      barColor: 'bg-emerald-500'
    }
  ];

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-2xl bg-zinc-900 text-white shadow-sm">
            <Bed className="w-4 h-4 text-[#FF8DA1]" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 leading-tight">Live Bed Inventory</h2>
            <p className="text-[11px] text-slate-500">PostgreSQL synchronized bed allocation state</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-mono bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200">
          <Clock className="w-3 h-3 text-slate-400" />
          <span>Synced with Postgres</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {bedTypes.map(({ type, label, sub, icon: Icon, accent, badgeBg, cardBg, barColor }) => {
          const bedData = beds[type] || { total: 0, available: 0, updatedAt: '' };
          const isBusy = updatingType === type || isLoading;
          const occupied = Math.max(0, bedData.total - bedData.available);
          const pctAvailable = bedData.total > 0 ? Math.round((bedData.available / bedData.total) * 100) : 0;

          return (
            <div
              key={type}
              className={`p-4 rounded-2xl border transition-all duration-200 hover:shadow-md ${cardBg}`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-xl border ${badgeBg}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">{type}</h3>
                    <p className="text-[10px] text-slate-500">{sub}</p>
                  </div>
                </div>

                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeBg}`}>
                  {pctAvailable}% FREE
                </span>
              </div>

              {/* Numbers */}
              <div className="flex items-baseline justify-between mb-3 bg-white/90 p-2.5 rounded-xl border border-slate-200/60">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Available</div>
                  <div className={`text-2xl font-mono font-extrabold ${accent}`}>
                    {bedData.available}
                    <span className="text-xs font-normal text-slate-400 ml-1">/ {bedData.total}</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total / Busy</div>
                  <div className="text-xs font-mono text-slate-600 font-semibold">
                    <span className="text-slate-800 font-bold">{bedData.total}</span> total / <span className="text-rose-600 font-bold">{occupied}</span> busy
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden mb-3">
                <div
                  className={`h-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pctAvailable}%` }}
                />
              </div>

              {/* Adjustment buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                <span className="text-[10px] text-slate-500 font-mono">
                  {formatTime(bedData.updatedAt)}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isBusy || bedData.available <= 0}
                    onClick={() => handleAdjust(type, -1)}
                    title={`Decrement ${type} available bed`}
                    className="p-1.5 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-30 text-slate-700 border border-slate-200 transition shadow-sm"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleAdjust(type, 1)}
                    title={`Increment ${type} available bed`}
                    className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-white transition shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#FF8DA1]" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
