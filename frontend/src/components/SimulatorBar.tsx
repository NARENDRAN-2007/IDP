import React, { useState } from 'react';
import { Play, Activity, Navigation, RotateCcw, Sparkles, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { api } from '../lib/api.js';

interface SimulatorBarProps {
  hospitalId: string;
  activePatientId?: string;
  activeAmbulanceId?: string;
  onActionComplete: () => void;
  isOpenControlled?: boolean;
  onToggleControlled?: () => void;
}

export function SimulatorBar({
  hospitalId,
  activePatientId,
  activeAmbulanceId,
  onActionComplete,
  isOpenControlled,
  onToggleControlled
}: SimulatorBarProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isOpenControlled !== undefined ? isOpenControlled : internalOpen;
  const toggle = () => {
    if (onToggleControlled) onToggleControlled();
    else setInternalOpen(!internalOpen);
  };

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleSimulateLoad = async (symptoms: string) => {
    try {
      setLoadingAction('load');
      await api.simulateLoad({
        count: 1,
        symptomsText: symptoms,
        targetHospitalId: hospitalId
      });
      showStatus('success', 'Emergency load injected! Checking incoming queue...');
      onActionComplete();
    } catch (err: any) {
      showStatus('error', err.message || 'Failed to inject emergency load');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSimulateGps = async () => {
    try {
      setLoadingAction('gps');
      const lat = 13.060 + (Math.random() - 0.5) * 0.02;
      const lng = 80.250 + (Math.random() - 0.5) * 0.02;
      await api.simulateGps({
        ambulanceId: activeAmbulanceId || 'AMB_CH_01',
        requestId: activePatientId,
        lat,
        lng,
        speed: 45
      });
      showStatus('success', 'Ambulance GPS telemetry transmitted.');
      onActionComplete();
    } catch (err: any) {
      showStatus('error', err.message || 'Failed to update GPS telemetry');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSimulateVitals = async (hr: number, spo2: number) => {
    if (!activePatientId) {
      showStatus('error', 'Select or await an incoming patient to inject vitals');
      return;
    }
    try {
      setLoadingAction('vitals');
      await api.simulateVitals({
        requestId: activePatientId,
        ambulanceId: activeAmbulanceId,
        hr,
        spo2,
        valid: true
      });
      showStatus('success', `Vitals telemetry updated: ${hr} BPM, ${spo2}% SpO2`);
      onActionComplete();
    } catch (err: any) {
      showStatus('error', err.message || 'Failed to simulate vitals');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset database beds and clear active simulator requests?')) return;
    try {
      setLoadingAction('reset');
      await api.simulateReset();
      showStatus('success', 'Simulator reset. Database returned to initial seed state.');
      onActionComplete();
    } catch (err: any) {
      showStatus('error', err.message || 'Failed to reset scenario');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 max-w-md w-full">
      <div className="bg-white border border-slate-200/90 rounded-3xl shadow-xl overflow-hidden backdrop-blur-xl">
        {/* Toggle Bar Header */}
        <div
          onClick={toggle}
          className="flex items-center justify-between px-4 py-3 bg-zinc-900 text-white cursor-pointer transition select-none"
        >
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-full bg-zinc-800 text-[#FF8DA1]">
              <Zap className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-bold tracking-tight">
              Emergency Simulator Console
            </span>
          </div>

          <div className="flex items-center gap-2">
            {statusMessage && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {statusMessage.text}
              </span>
            )}
            <button className="text-slate-400 hover:text-white">
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Collapsible Action Drawer */}
        {isOpen && (
          <div className="p-4 space-y-3 bg-white">
            <div className="text-[11px] text-slate-500 font-medium">
              Simulate dispatches & live IoT telemetry against <span className="font-mono font-bold text-slate-800">{hospitalId}</span>:
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!!loadingAction}
                onClick={() =>
                  handleSimulateLoad(
                    'Patient experiencing severe crushing chest pain, diaphoresis, shortness of breath, radiating to left arm'
                  )
                }
                className="p-3 rounded-2xl bg-amber-50 hover:bg-amber-100/70 border border-amber-200/80 text-left transition"
              >
                <div className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                  Chest Pain (L1)
                </div>
                <div className="text-[10px] text-amber-700/80 mt-0.5 font-medium">Cardiac arrest hold trigger</div>
              </button>

              <button
                type="button"
                disabled={!!loadingAction}
                onClick={() =>
                  handleSimulateLoad(
                    'High velocity road traffic collision, polytrauma, multiple fractures, massive bleeding'
                  )
                }
                className="p-3 rounded-2xl bg-rose-50 hover:bg-rose-100/70 border border-rose-200/80 text-left transition"
              >
                <div className="font-bold text-xs text-rose-900 flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-rose-600 fill-rose-600" />
                  Polytrauma (L2)
                </div>
                <div className="text-[10px] text-rose-700/80 mt-0.5 font-medium">Emergency ER bay trigger</div>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!!loadingAction}
                onClick={handleSimulateGps}
                className="p-2.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition flex items-center gap-2"
              >
                <Navigation className="w-4 h-4 text-sky-600" />
                <div>
                  <div className="font-bold text-slate-800 text-[11px]">Send GPS Radar Ping</div>
                  <div className="text-[10px] text-slate-500">Updates live ambulance coordinates</div>
                </div>
              </button>

              <button
                type="button"
                disabled={!!loadingAction}
                onClick={() => handleSimulateVitals(138, 88)}
                className="p-2.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition flex items-center gap-2"
              >
                <Activity className="w-4 h-4 text-rose-500" />
                <div>
                  <div className="font-bold text-slate-800 text-[11px]">Push IoT Vitals</div>
                  <div className="text-[10px] text-slate-500">HR 138 BPM / 88% SpO2</div>
                </div>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                disabled={!!loadingAction}
                onClick={handleReset}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Demo State</span>
              </button>

              <span className="text-[10px] text-slate-400 font-mono">
                {loadingAction ? 'Processing...' : 'Ready'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
