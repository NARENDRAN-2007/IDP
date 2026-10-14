import React, { useState } from 'react';
import { ClipboardCheck, CheckSquare, Square, Shield, Droplets } from 'lucide-react';

interface PreArrivalChecklistProps {
  selectedPatient?: any;
}

export function PreArrivalChecklist({ selectedPatient }: PreArrivalChecklistProps) {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  const toggleItem = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const severityLevel = selectedPatient?.severityLevel || 2;
  const specialty = selectedPatient?.requiredSpecialty || 'cardiac';

  // Dynamic clinical checklist based on patient severity and specialty
  const checklist = [
    {
      id: 'bay_prep',
      label: 'Resuscitation Bay Pre-warmed & Oxygen Flowing',
      category: 'Environment',
      critical: true
    },
    {
      id: 'monitoring',
      label: 'Telemetry Monitor & 12-Lead ECG Leads Ready',
      category: 'Equipment',
      critical: specialty === 'cardiac' || severityLevel === 1
    },
    {
      id: 'airway',
      label: 'Difficult Airway Cart & Portable Ventilator Checked',
      category: 'Airway',
      critical: severityLevel === 1
    },
    {
      id: 'defib',
      label: 'Crash Cart & Biphasic Defibrillator Synced',
      category: 'Equipment',
      critical: specialty === 'cardiac'
    },
    {
      id: 'blood',
      label: 'O-Negative Emergency Blood Units (PRBC) on Standby',
      category: 'Transfusion',
      critical: severityLevel <= 2
    },
    {
      id: 'iv_access',
      label: 'Rapid Infuser & Large Bore IV Kits Available',
      category: 'Vascular',
      critical: false
    },
    {
      id: 'specialist_alert',
      label: `On-Call ${specialty.toUpperCase()} Attending Physician Alerted`,
      category: 'Staffing',
      critical: true
    }
  ];

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-2xl bg-zinc-900 text-white shadow-sm">
            <ClipboardCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 leading-tight">Pre-Arrival Protocols</h2>
            <p className="text-[11px] text-slate-500">
              {selectedPatient
                ? `Checklist for ${selectedPatient.patientName || selectedPatient.requestId} (Level ${severityLevel})`
                : 'Trauma bay preparation checklist'}
            </p>
          </div>
        </div>

        {selectedPatient && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <Droplets className="w-3 h-3 text-rose-500" />
            Blood: O+ Standby
          </span>
        )}
      </div>

      <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
        {checklist.map((item) => {
          const isDone = !!checkedItems[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleItem(item.id)}
              className={`w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition ${
                isDone
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800 line-through'
                  : 'bg-slate-50/80 border-slate-200/80 text-slate-800 hover:border-slate-300 hover:bg-slate-100/80'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {isDone ? (
                  <CheckSquare className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                )}
                <span className="text-xs font-semibold">{item.label}</span>
              </div>

              {item.critical && !isDone && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                  Critical
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
