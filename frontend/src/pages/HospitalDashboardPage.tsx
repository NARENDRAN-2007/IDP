import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRoute, useLocation } from 'wouter';
import {
  Activity,
  Bed,
  UserCheck,
  MapPin,
  Clock,
  LogOut,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  FileText,
  History,
  ShieldCheck,
  Ambulance,
  PhoneCall,
  Sparkles,
  Search,
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Heart,
  ShieldAlert,
  Zap,
  Radio
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { useSocket } from '../contexts/SocketContext.js';
import { api } from '../lib/api.js';
import { cn, formatTime } from '../lib/utils.js';
import { Countdown } from '../components/Countdown.js';
import { VitalsBadge } from '../components/VitalsBadge.js';
import { RejectModal } from '../components/RejectModal.js';
import { BedManagementWidget } from '../components/BedManagementWidget.js';
import { DoctorsWidget } from '../components/DoctorsWidget.js';
import { PreArrivalChecklist } from '../components/PreArrivalChecklist.js';
import { MapView } from '../components/Map.js';
import { SimulatorBar } from '../components/SimulatorBar.js';
import { HistoryView } from '../components/HistoryView.js';
import { AuditTrailView } from '../components/AuditTrailView.js';

const HOSPITAL_NAMES: Record<string, string> = {
  H001: 'Apollo Hospital Greams Road',
  H002: 'MGM Healthcare',
  H003: 'Rajiv Gandhi Govt General Hospital',
  H004: 'Fortis Malar Hospital',
  H005: 'MIOT International',
  H006: 'SIMS Hospital Vadapalani',
  H007: 'Kauvery Hospital Alwarpet',
  H008: 'Gleneagles Global Health City'
};

const HOSPITAL_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  H001: { lat: 13.063182, lng: 80.251538 },
  H002: { lat: 13.070989, lng: 80.221668 },
  H003: { lat: 13.081416, lng: 80.277579 },
  H004: { lat: 13.069188, lng: 80.273711 },
  H005: { lat: 12.897849, lng: 80.206184 },
  H006: { lat: 13.07796, lng: 80.241539 },
  H007: { lat: 13.023243, lng: 80.187311 },
  H008: { lat: 13.053167, lng: 80.211756 }
};

export function HospitalDashboardPage() {
  const [, params] = useRoute('/hospital/:hospitalId');
  const [, setLocation] = useLocation();
  const { user, hospitalId: authHospitalId, logout } = useAuth();
  const { isConnected, isPollingFallback, onRefreshTrigger } = useSocket();

  const hospitalId = authHospitalId || params?.hospitalId || 'H001';
  const hospitalName = HOSPITAL_NAMES[hospitalId] || `${hospitalId} Trauma Center`;

  // State
  const [incomingPatients, setIncomingPatients] = useState<any[]>([]);
  const [beds, setBeds] = useState<Record<string, any>>({});
  const [doctorsOnDuty, setDoctorsOnDuty] = useState<any[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [arrivedBanner, setArrivedBanner] = useState<string | null>(null);

  // Reject Modal State
  const [rejectingPatientId, setRejectingPatientId] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);

  // Active Navigation View (Board, Beds, Doctors, History, Audit)
  const [activeNav, setActiveNav] = useState<'board' | 'beds' | 'doctors' | 'history' | 'audit'>('board');

  // Enforce single-hospital scope URL alignment
  useEffect(() => {
    if (authHospitalId && params?.hospitalId && params.hospitalId !== authHospitalId) {
      setLocation(`/hospital/${authHospitalId}`);
    }
  }, [authHospitalId, params?.hospitalId, setLocation]);

  // Load incoming data
  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    try {
      const data = await api.getIncoming(hospitalId);
      setIncomingPatients(data.incomingPatients || []);
      setBeds(data.beds || {});
      setDoctorsOnDuty(data.doctorsOnDuty || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load hospital incoming queue');
    } finally {
      setIsLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh hook triggered by Socket.IO events or fallback poller
  useEffect(() => {
    const unsubscribe = onRefreshTrigger(() => {
      fetchData();
    });
    return unsubscribe;
  }, [onRefreshTrigger, fetchData]);

  // Handle Accept
  const handleAccept = async (reqId: string, bedType?: string) => {
    try {
      setActionInProgress(reqId);
      const targetPatient = incomingPatients.find((p) => p.requestId === reqId);
      const resolvedBedType = ((bedType || targetPatient?.bedType || 'ER') as 'ER' | 'ICU' | 'General').toUpperCase();

      // Immediately decrement local bed count so the UI bed counter decreases on click!
      setBeds((prev) => {
        const copy = { ...prev };
        if (copy[resolvedBedType]) {
          copy[resolvedBedType] = {
            ...copy[resolvedBedType],
            available: Math.max(0, copy[resolvedBedType].available - 1)
          };
        }
        return copy;
      });

      const res = await api.acceptPatient(hospitalId, reqId);

      const allocatedDoc = res?.allocatedDoctor || targetPatient?.allocatedDoctor;
      const docName = allocatedDoc?.name || 'On-Duty Specialist';
      const docSpec = (allocatedDoc?.specialty || targetPatient?.requiredSpecialty || 'General').toUpperCase();
      const docRoom = allocatedDoc?.room || 'Emergency Trauma Resuscitation';

      if (res?.updatedBedAvailable !== undefined && res.bedType) {
        setBeds((prev) => ({
          ...prev,
          [res.bedType]: {
            ...prev[res.bedType],
            available: res.updatedBedAvailable
          }
        }));
      }

      setArrivedBanner(
        `✓ Bed Hold Accepted for Case ${reqId}! ${resolvedBedType} bed count decreased by 1. Allocated Doctor: ${docName} (${docSpec} • ${docRoom}) assigned.`
      );
      setTimeout(() => setArrivedBanner(null), 8000);

      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to accept patient bed hold');
      await fetchData();
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle Reject & Cascade
  const handleConfirmReject = async (reason: string) => {
    if (!rejectingPatientId) return;
    try {
      setIsRejecting(true);
      await api.rejectPatient(hospitalId, rejectingPatientId, reason);
      setRejectingPatientId(null);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to reject and cascade request');
    } finally {
      setIsRejecting(false);
    }
  };

  // Handle Mark Arrived / Handover
  const handleArrived = async (reqId: string) => {
    try {
      setActionInProgress(reqId);
      await api.markPatientArrived(hospitalId, reqId);
      setArrivedBanner(
        `✓ Patient ${reqId} successfully arrived! Clinical handover completed, trauma bed confirmed, and ambulance freed to emergency fleet.`
      );
      setTimeout(() => setArrivedBanner(null), 6000);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to mark patient arrived');
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle Bed Capacity Adjustments
  const handleUpdateBed = async (bedType: 'ER' | 'ICU' | 'General', delta: number) => {
    try {
      await api.updateBeds(hospitalId, bedType, delta);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to adjust bed capacity');
    }
  };

  // Filter patients by search query
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return incomingPatients;
    const q = searchQuery.toLowerCase();
    return incomingPatients.filter(
      (p) =>
        (p.requestId && p.requestId.toLowerCase().includes(q)) ||
        (p.chiefComplaint && p.chiefComplaint.toLowerCase().includes(q)) ||
        (p.requiredSpecialty && p.requiredSpecialty.toLowerCase().includes(q)) ||
        (p.ambulance?.plate && p.ambulance.plate.toLowerCase().includes(q)) ||
        (p.bedType && p.bedType.toLowerCase().includes(q))
    );
  }, [incomingPatients, searchQuery]);

  const selectedPatient = useMemo(() => {
    if (!filteredPatients.length) return null;
    if (selectedPatientId) {
      const found = filteredPatients.find((p) => p.requestId === selectedPatientId);
      if (found) return found;
    }
    return filteredPatients[0];
  }, [filteredPatients, selectedPatientId]);

  // Map incoming ambulances with isConfirmed flag for real-time map driving
  const incomingAmbulanceMarkers = useMemo(() => {
    return incomingPatients
      .filter((p) => p.ambulance && p.ambulance.lat && p.ambulance.lng)
      .map((p) => {
        const isConfirmed =
          p.status === 'HOSPITAL_ACCEPTED' ||
          p.status === 'CONFIRMED' ||
          p.holdStatus === 'CONFIRMED' ||
          p.hold?.status === 'confirmed';
        return {
          id: p.ambulance.id || p.requestId,
          plate: p.ambulance.plate || 'Emergency Unit',
          lat: p.ambulance.lat,
          lng: p.ambulance.lng,
          speed: p.ambulance.speed,
          etaMinutes: p.ambulance.etaMinutes ?? 8,
          isStale: p.ambulance.isStale,
          requestId: p.requestId,
          isConfirmed
        };
      });
  }, [incomingPatients]);

  const activePatientForSimulator = selectedPatient?.requestId || incomingPatients[0]?.requestId;
  const activeAmbulanceForSimulator = selectedPatient?.ambulance?.id || incomingPatients[0]?.ambulance?.id;

  // Real Hospital Stats for Bento Cards
  const criticalCount = useMemo(
    () => incomingPatients.filter((p) => p.severityLevel === 1).length,
    [incomingPatients]
  );
  const pendingHoldsCount = useMemo(
    () =>
      incomingPatients.filter(
        (p) =>
          p.status === 'HOLD_PENDING' ||
          p.holdStatus === 'HOLD_PENDING' ||
          p.hold?.status === 'pending'
      ).length,
    [incomingPatients]
  );
  const confirmedCount = useMemo(
    () =>
      incomingPatients.filter(
        (p) =>
          p.status === 'HOSPITAL_ACCEPTED' ||
          p.status === 'CONFIRMED' ||
          p.holdStatus === 'CONFIRMED' ||
          p.hold?.status === 'confirmed'
      ).length,
    [incomingPatients]
  );

  // Vitals stats across real queue
  const latestVitals = useMemo(() => {
    const validPatient = incomingPatients.find((p) => p.vitals?.hr || p.vitals?.spo2);
    return validPatient?.vitals || null;
  }, [incomingPatients]);

  const nearestEta = useMemo(() => {
    const etas = incomingPatients
      .map((p) => p.ambulance?.etaMinutes)
      .filter((e) => typeof e === 'number');
    return etas.length ? Math.min(...etas) : null;
  }, [incomingPatients]);

  return (
    <div className="min-h-screen bg-[#F5F6FA] text-slate-900 flex selection:bg-[#FF8DA1]/30">
      {/* 1. LEFT SLEEK FLOATING SIDEBAR (Format matching image) */}
      <aside className="w-64 p-4 flex flex-col justify-between shrink-0 hidden lg:flex select-none">
        <div className="bg-[#15161A] text-white rounded-3xl p-5 shadow-xl flex flex-col h-[calc(100vh-2rem)] sticky top-4 justify-between">
          <div>
            {/* Logo */}
            <div className="flex items-center gap-2 px-2 pb-6 pt-1 border-b border-zinc-800/80">
              <div className="p-2 rounded-xl bg-zinc-900 text-[#FF8DA1] border border-zinc-800">
                <Activity className="w-5 h-5 animate-pulse-heart" />
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-black tracking-tight text-white">PulseER</span>
                  <span className="text-xl font-black text-[#FF8DA1]">+</span>
                </div>
                <div className="text-[10px] text-zinc-400 font-mono tracking-wider font-semibold">
                  STATION {hospitalId}
                </div>
              </div>
            </div>

            {/* Navigation Group: ER DESK GENERAL */}
            <div className="mt-6 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-3 pb-2">
                Command Station
              </div>

              <button
                onClick={() => setActiveNav('board')}
                className={cn(
                  'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-left',
                  activeNav === 'board'
                    ? 'bg-[#291B24] text-[#FF8DA1] shadow-xs'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                )}
              >
                <div className="flex items-center gap-3">
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Incoming Queue</span>
                </div>
                {incomingPatients.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-800 text-[#FF8DA1] font-mono font-bold">
                    {incomingPatients.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveNav('beds')}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-left',
                  activeNav === 'beds'
                    ? 'bg-[#291B24] text-[#FF8DA1]'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                )}
              >
                <Bed className="w-4 h-4" />
                <span>Live Bed Inventory</span>
              </button>

              <button
                onClick={() => setActiveNav('doctors')}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-left',
                  activeNav === 'doctors'
                    ? 'bg-[#291B24] text-[#FF8DA1]'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                )}
              >
                <UserCheck className="w-4 h-4" />
                <span>Doctors on Duty</span>
              </button>
            </div>

            {/* Navigation Group: RECORDS & AUDIT */}
            <div className="mt-6 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-3 pb-2">
                Governance & Log
              </div>

              <button
                onClick={() => setActiveNav('history')}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-left',
                  activeNav === 'history'
                    ? 'bg-[#291B24] text-[#FF8DA1]'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                )}
              >
                <History className="w-4 h-4" />
                <span>Admission History</span>
              </button>

              <button
                onClick={() => setActiveNav('audit')}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-left',
                  activeNav === 'audit'
                    ? 'bg-[#291B24] text-[#FF8DA1]'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                )}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Sec 13 Audit Trail</span>
              </button>

              <button
                onClick={() => setIsSimulatorOpen(true)}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition text-zinc-400 hover:text-white hover:bg-zinc-800/50"
              >
                <Zap className="w-4 h-4 text-[#FF8DA1]" />
                <span>Emergency Simulator</span>
              </button>
            </div>
          </div>

          {/* User Profile Pill at Bottom of Sidebar */}
          <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-600 to-rose-400 text-white font-black flex items-center justify-center text-xs shadow-xs shrink-0">
                ER
              </div>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">ER Desk Staff</div>
                <div className="text-[10px] text-zinc-400 truncate">{user?.email || 'staff@hospital.er'}</div>
              </div>
            </div>

            <button
              onClick={logout}
              title="Logout from Station"
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE / CONTENT AREA */}
      <div className="flex-1 min-w-0 p-5 lg:p-7 flex flex-col gap-6 max-w-[1540px]">
        {/* Top Header Bar */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-sm font-extrabold text-slate-900 tracking-tight">
                {hospitalName}
              </h1>
              <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-zinc-950 text-white font-bold">
                {hospitalId}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border',
                  isConnected
                    ? 'bg-[#E5F8ED] text-[#15803D] border-[#DCFCE7]'
                    : isPollingFallback
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                )}
              >
                {isConnected ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
                    <span>SYSTEM STATUS: OPTIMAL (LIVE WS SYNC)</span>
                  </>
                ) : isPollingFallback ? (
                  <>
                    <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                    <span>2S POLLING FALLBACK</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 text-rose-600" />
                    <span>RECONNECTING...</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Search bar and Circular action buttons */}
          <div className="flex items-center gap-3">
            <div className="relative min-w-[280px] max-w-sm w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search requests, severity, beds..."
                className="w-full pl-11 pr-24 py-2.5 rounded-full bg-white border border-slate-200/90 text-xs text-slate-900 placeholder-slate-400 shadow-2xs focus:outline-none focus:border-zinc-900 transition"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-black text-white text-[10px] font-bold">
                In: ER Desk
              </span>
            </div>

            <button
              onClick={() => setIsSimulatorOpen(!isSimulatorOpen)}
              className="w-10 h-10 rounded-full bg-zinc-950 hover:bg-zinc-800 text-white flex items-center justify-center transition shrink-0 shadow-xs"
              title="Open Emergency Simulator"
            >
              <Zap className="w-4 h-4 text-[#FF8DA1]" />
            </button>

            <button
              onClick={fetchData}
              disabled={isLoading}
              className="w-10 h-10 rounded-full bg-zinc-950 hover:bg-zinc-800 text-white flex items-center justify-center transition shrink-0 shadow-xs"
              title="Refresh Queue"
            >
              <RefreshCw className={cn('w-4 h-4', isLoading ? 'animate-spin' : '')} />
            </button>
          </div>
        </header>

        {/* Welcome Greeting Banner */}
        <section>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-slate-950 tracking-tight font-sans">
            Good evening, ER Desk Station
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 font-medium leading-relaxed">
            Availability-Aware Emergency Response & Bed Reservation Platform • {incomingPatients.length} active emergency dispatches en route to your station.
          </p>
        </section>

        {/* Quick Station Navigation Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 select-none">
          <button
            onClick={() => setActiveNav('board')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer shrink-0 shadow-2xs',
              activeNav === 'board'
                ? 'bg-zinc-950 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80'
            )}
          >
            <LayoutDashboard className="w-4 h-4 text-[#FF8DA1]" />
            <span>Incoming Queue</span>
            {incomingPatients.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500 text-white font-mono font-bold">
                {incomingPatients.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveNav('history')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer shrink-0 shadow-2xs',
              activeNav === 'history'
                ? 'bg-zinc-950 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80'
            )}
          >
            <History className="w-4 h-4 text-cyan-600" />
            <span>Admission History</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-50 text-indigo-700 font-mono font-bold border border-indigo-200">
              Past Patients & Doctors
            </span>
          </button>

          <button
            onClick={() => setActiveNav('doctors')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer shrink-0 shadow-2xs',
              activeNav === 'doctors'
                ? 'bg-zinc-950 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80'
            )}
          >
            <UserCheck className="w-4 h-4 text-purple-600" />
            <span>Doctors on Duty</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-50 text-purple-700 font-mono font-bold border border-purple-200">
              {doctorsOnDuty.length} Active
            </span>
          </button>

          <button
            onClick={() => setActiveNav('beds')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer shrink-0 shadow-2xs',
              activeNav === 'beds'
                ? 'bg-zinc-950 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80'
            )}
          >
            <Bed className="w-4 h-4 text-emerald-600" />
            <span>Live Bed Inventory</span>
          </button>

          <button
            onClick={() => setActiveNav('audit')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer shrink-0 shadow-2xs',
              activeNav === 'audit'
                ? 'bg-zinc-950 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80'
            )}
          >
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <span>Section 13 Audit Trail</span>
          </button>
        </div>

        {/* 3. 4 BENTO PASTEL METRIC CARDS (REAL HOSPITAL DATA) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {/* CARD 1: HONEY GOLDEN YELLOW (#F6CA38) - Emergency Queue */}
          <div className="relative overflow-hidden rounded-3xl p-6 bg-[#F6CA38] text-zinc-950 shadow-sm flex flex-col justify-between min-h-[190px]">
            {/* Subtle Giant Watermark Cross */}
            <div className="absolute -top-6 -right-6 text-black/10 select-none pointer-events-none">
              <span className="text-[170px] font-black leading-none font-sans">+</span>
            </div>

            <div>
              <h3 className="text-base font-bold text-zinc-950 mb-3">Incoming Queue:</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {incomingPatients.length} <span className="text-xs font-bold text-zinc-800">cases</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    En Route
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {criticalCount} <span className="text-xs font-bold text-zinc-800">cases</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Level 1 Resus
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {pendingHoldsCount} <span className="text-xs font-bold text-zinc-800">holds</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    30s Holds
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Equalizer Bars */}
            <div className="flex items-end gap-1.5 pt-3 z-10">
              <span className="w-2.5 h-6 bg-zinc-950 rounded-full" />
              <span className="w-2.5 h-10 bg-zinc-950 rounded-full" />
              <span className="w-2.5 h-7 bg-zinc-950 rounded-full" />
              <span className="w-2.5 h-12 bg-zinc-950 rounded-full" />
              <span className="w-2.5 h-8 bg-zinc-950 rounded-full" />
              <span className="w-2.5 h-4 bg-zinc-950 rounded-full" />
            </div>
          </div>

          {/* CARD 2: PASTEL ROSE PINK (#F8A4B0) - Live Vitals & Telemetry */}
          <div className="relative overflow-hidden rounded-3xl p-6 bg-[#F8A4B0] text-zinc-950 shadow-sm flex flex-col justify-between min-h-[190px]">
            {/* Subtle Giant Heart Watermark */}
            <div className="absolute top-2 right-4 text-black/10 select-none pointer-events-none">
              <Heart className="w-24 h-24 fill-black/10 stroke-none" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-zinc-950">Live Vitals & Risk:</h3>
                <span className="text-[10px] font-bold text-zinc-800 font-mono">MAX30102 IoT</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {latestVitals?.hr ? `${latestVitals.hr}` : '--'} <span className="text-xs font-bold text-zinc-800">bpm</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Heart Rate
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {latestVitals?.spo2 ? `${latestVitals.spo2}%` : '--'}
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Blood O2
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {latestVitals?.valid ? 'VALID' : 'LIVE'}
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Telemetry
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Wave Sparkline SVG */}
            <div className="pt-2 z-10">
              <svg className="w-full h-7 overflow-visible" viewBox="0 0 200 30" fill="none">
                <path
                  d="M 5 22 C 40 22, 70 18, 100 12 C 130 8, 160 6, 195 15"
                  stroke="#111827"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <circle cx="100" cy="12" r="3.5" fill="#111827" />
                <circle cx="195" cy="15" r="3.5" fill="#111827" />
              </svg>
            </div>
          </div>

          {/* CARD 3: CHARTREUSE / LIME GREEN (#C6D752) - Real Bed Capacity */}
          <div className="relative overflow-hidden rounded-3xl p-6 bg-[#C6D752] text-zinc-950 shadow-sm flex flex-col justify-between min-h-[190px]">
            {/* Subtle Giant Triangle Watermark */}
            <div className="absolute -top-3 -right-3 text-black/10 select-none pointer-events-none">
              <svg className="w-28 h-28 fill-black/10" viewBox="0 0 100 100">
                <polygon points="50,10 90,90 10,90" />
              </svg>
            </div>

            <div>
              <h3 className="text-base font-bold text-zinc-950 mb-3">Bed Availability:</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {beds.ICU?.available ?? 0} <span className="text-xs font-bold text-zinc-800">beds</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    ICU Free
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {beds.ER?.available ?? 0} <span className="text-xs font-bold text-zinc-800">beds</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    ER Resus
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {beds.General?.available ?? 0} <span className="text-xs font-bold text-zinc-800">beds</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    General
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-bold text-zinc-800 flex items-center gap-1.5 pt-2">
              <span>Postgres Atomic Lock</span>
              <span>•</span>
              <span>Live Updates</span>
            </div>
          </div>

          {/* CARD 4: POWDER SKY BLUE (#96CEF0) - Response Times & ETA */}
          <div className="relative overflow-hidden rounded-3xl p-6 bg-[#96CEF0] text-zinc-950 shadow-sm flex flex-col justify-between min-h-[190px]">
            {/* Subtle Giant Star Watermark */}
            <div className="absolute -top-4 -right-4 text-black/10 select-none pointer-events-none">
              <svg className="w-32 h-32 fill-black/10" viewBox="0 0 100 100">
                <polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" />
              </svg>
            </div>

            <div>
              <h3 className="text-base font-bold text-zinc-950 mb-3">Response Times:</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {nearestEta ? `${nearestEta}m` : '--'}
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Nearest ETA
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    30s
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Hold Window
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-black font-sans leading-none">
                    {confirmedCount} <span className="text-xs font-bold text-zinc-800">beds</span>
                  </div>
                  <div className="text-[10px] font-extrabold tracking-wider text-zinc-800 uppercase mt-1">
                    Confirmed
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-bold text-zinc-800 flex items-center gap-1.5 pt-2">
              <span>Automated Cascade Active</span>
            </div>
          </div>
        </div>

        {/* Clinical Handover / Arrival Confirmation Banner */}
        {arrivedBanner && (
          <div className="mb-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 flex items-center justify-between shadow-sm animate-fadeIn">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-xl bg-emerald-600 text-white shadow-xs">
                <CheckCircle className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold">{arrivedBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setArrivedBanner(null)}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-950 px-2 py-1 rounded-lg"
            >
              ✕
            </button>
          </div>
        )}

        {/* 4. MAIN CORE CONTENT (All real hospital components preserved) */}
        {activeNav === 'board' && (
          <div className="space-y-6">
            {/* Main Two-Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column (7 cols): Incoming Emergency Queue */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Ambulance className="w-5 h-5 text-rose-600" />
                    <h2 className="text-base font-extrabold text-slate-900">
                      Incoming Emergency Queue ({filteredPatients.length})
                    </h2>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-500">
                    Auto-Cascade 30s
                  </span>
                </div>

                {isLoading && incomingPatients.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-sm bg-white rounded-3xl border border-slate-200">
                    Connecting to Hospital Dispatch Hub...
                  </div>
                ) : filteredPatients.length === 0 ? (
                  <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-3 shadow-xs">
                    <div className="inline-flex p-3 rounded-2xl bg-slate-100 text-slate-400">
                      <Ambulance className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">No active incoming patients</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      All emergency holds are currently resolved. Use the Evaluation Simulator below to trigger an emergency call dispatch.
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsSimulatorOpen(true)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-950 text-white hover:bg-zinc-800 transition"
                    >
                      Trigger Test Emergency SOS
                    </button>
                  </div>
                ) : (
                  filteredPatients.map((patient) => {
                    const isSelected = selectedPatient?.requestId === patient.requestId;
                    const isPendingHold =
                      patient.status === 'HOLD_PENDING' ||
                      patient.holdStatus === 'HOLD_PENDING' ||
                      patient.hold?.status === 'pending';
                    const isConfirmed =
                      patient.status === 'HOSPITAL_ACCEPTED' ||
                      patient.status === 'CONFIRMED' ||
                      patient.holdStatus === 'CONFIRMED' ||
                      patient.hold?.status === 'confirmed';
                    const isBusy = actionInProgress === patient.requestId;
                    const expiresAt = patient.holdExpiresAt || patient.hold?.expiresAt;

                    return (
                      <div
                        key={patient.requestId}
                        onClick={() => setSelectedPatientId(patient.requestId)}
                        className={cn(
                          'p-5 rounded-3xl border transition-all duration-200 cursor-pointer shadow-xs',
                          isSelected
                            ? 'bg-white border-zinc-900 ring-2 ring-zinc-900/10 shadow-md'
                            : 'bg-white hover:bg-slate-50/80 border-slate-200/90'
                        )}
                      >
                        {/* Header: Request ID, Hold Timer & Severity */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                              {patient.requestId}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full border',
                                patient.severityLevel === 1
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : patient.severityLevel === 2
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-blue-50 text-blue-800 border-blue-200'
                              )}
                            >
                              Level {patient.severityLevel} • {patient.severityCategory || 'Emergent'}
                            </span>
                          </div>

                          {/* Countdown Timer or Confirmed badge */}
                          {isPendingHold ? (
                            <Countdown
                              expiresAt={expiresAt}
                              onExpire={() => {
                                setTimeout(fetchData, 1000);
                              }}
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              CONFIRMED RESERVATION
                            </span>
                          )}
                        </div>

                        {/* Chief complaint & keywords */}
                        <div className="mb-3">
                          <p className="text-xs text-slate-900 font-semibold leading-relaxed">
                            {patient.chiefComplaint || 'Emergency medical service transport en route'}
                          </p>
                          {patient.symptomKeywords && patient.symptomKeywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {patient.symptomKeywords.map((kw: string, i: number) => (
                                <span
                                  key={i}
                                  className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium border border-slate-200"
                                >
                                  #{kw}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Bed Held + Ambulance Status strip */}
                        <div className="grid grid-cols-2 gap-2.5 mb-3 text-xs">
                          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                            <span className="text-slate-500 text-[11px] font-semibold">Bed Reserved:</span>
                            <span className="font-mono font-bold text-rose-600 flex items-center gap-1">
                              <Bed className="w-3.5 h-3.5" />
                              {patient.bedType || 'ER'}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                            <span className="text-slate-500 text-[11px] font-semibold">Ambulance ETA:</span>
                            <span className="font-mono font-bold text-emerald-700 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {patient.ambulance?.etaMinutes ?? 8} min
                            </span>
                          </div>
                        </div>

                        {/* Vitals Telemetry Badge (MAX30102 with staleness indicator) */}
                        <VitalsBadge vitals={patient.vitals} className="mb-3" />

                        {/* Allocated Doctor Strip */}
                        <div className="p-3.5 rounded-2xl bg-indigo-50/80 border border-indigo-100/90 flex items-center justify-between mb-3 text-xs shadow-2xs">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-xs">
                              <UserCheck className="w-4 h-4" />
                            </div>
                            <div className="truncate">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-md">
                                  {isConfirmed ? 'Allocated Attending Doctor' : 'Designated Attending Doctor'}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 truncate">
                                  • {patient.allocatedDoctor?.room || (patient.requiredSpecialty?.toLowerCase() === 'neuro' ? 'Neuro OT 3 / Brain & Spine' : 'Trauma Resuscitation Bay 1')}
                                </span>
                              </div>
                              <div className="text-xs font-black text-slate-900 mt-1 flex items-center gap-2">
                                <span>{patient.allocatedDoctor?.name || (patient.requiredSpecialty?.toLowerCase() === 'neuro' ? 'Dr. Rajesh K. Sundaram' : 'Dr. Vikramaditya Sen')}</span>
                                <span className="text-[10px] font-extrabold text-indigo-600 uppercase font-mono">
                                  ({patient.allocatedDoctor?.specialty || patient.requiredSpecialty || 'NEURO'})
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0 pl-2">
                            <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100/90 px-2.5 py-1 rounded-lg border border-emerald-200">
                              {isConfirmed ? 'Bed & Staff Assigned' : 'On-Duty Ready'}
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons: Accept / Reject or Mark Arrived */}
                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                          {isPendingHold ? (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRejectingPatientId(patient.requestId);
                                }}
                                className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 transition"
                              >
                                Reject & Cascade
                              </button>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAccept(patient.requestId, patient.bedType);
                                }}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-950 hover:bg-zinc-800 text-white shadow-xs transition flex items-center gap-1.5"
                              >
                                <CheckCircle className="w-3.5 h-3.5 text-[#FF8DA1]" />
                                <span>{isBusy ? 'Confirming...' : 'Accept Bed Hold'}</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArrived(patient.requestId);
                              }}
                              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle className="w-3.5 h-3.5 text-white" />
                              <span>{isBusy ? 'Processing Handover...' : 'Mark Arrived & Handover'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Right Column (5 cols): Pre-Arrival Prep & GPS Map */}
              <div className="lg:col-span-5 space-y-6">
                {/* Clinical Pre-Arrival Protocols */}
                <PreArrivalChecklist selectedPatient={selectedPatient} />

                {/* Chennai Metropolitan Fleet GPS Radar Map */}
                <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-rose-600" />
                      Live Ambulance GPS Tracking
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      Chennai Fleet
                    </span>
                  </div>
                  <MapView
                    hospitalLocation={{
                      lat: HOSPITAL_LOCATIONS[hospitalId]?.lat || 13.063182,
                      lng: HOSPITAL_LOCATIONS[hospitalId]?.lng || 80.251538,
                      name: hospitalName
                    }}
                    incomingAmbulances={incomingAmbulanceMarkers}
                    onAmbulanceArrived={(reqId) => {
                      setSelectedPatientId(reqId);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Bed Management and Doctors Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
              <div className="lg:col-span-2">
                <BedManagementWidget beds={beds} onUpdateBed={handleUpdateBed} isLoading={isLoading} />
              </div>
              <div className="lg:col-span-1">
                <DoctorsWidget doctors={doctorsOnDuty} isFullView={false} />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Bed Management View */}
        {activeNav === 'beds' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Bed Inventory & Capacity Management</h2>
              <button
                onClick={() => setActiveNav('board')}
                className="text-xs font-bold text-slate-600 hover:text-black"
              >
                Back to Command Board
              </button>
            </div>
            <BedManagementWidget beds={beds} onUpdateBed={handleUpdateBed} isLoading={isLoading} />
          </div>
        )}

        {/* Tab 3: Doctors View */}
        {activeNav === 'doctors' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Clinical Staffing & Doctor Shifts</h2>
              <button
                onClick={() => setActiveNav('board')}
                className="text-xs font-bold text-slate-600 hover:text-black"
              >
                Back to Command Board
              </button>
            </div>
            <DoctorsWidget doctors={doctorsOnDuty} isFullView={true} />
          </div>
        )}

        {/* Tab 4: History View */}
        {activeNav === 'history' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Hospital Patient Admission History</h2>
              <button
                onClick={() => setActiveNav('board')}
                className="text-xs font-bold text-slate-600 hover:text-black"
              >
                Back to Command Board
              </button>
            </div>
            <HistoryView hospitalId={hospitalId} />
          </div>
        )}

        {/* Tab 5: Immutable Audit Trail */}
        {activeNav === 'audit' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Section 13 Real-time Audit Trail</h2>
              <button
                onClick={() => setActiveNav('board')}
                className="text-xs font-bold text-slate-600 hover:text-black"
              >
                Back to Command Board
              </button>
            </div>
            <AuditTrailView hospitalId={hospitalId} />
          </div>
        )}
      </div>

      {/* Floating Simulator Console */}
      <SimulatorBar
        hospitalId={hospitalId}
        activePatientId={activePatientForSimulator}
        activeAmbulanceId={activeAmbulanceForSimulator}
        onActionComplete={fetchData}
        isOpenControlled={isSimulatorOpen}
        onToggleControlled={() => setIsSimulatorOpen(!isSimulatorOpen)}
      />

      {/* Reject Modal */}
      {rejectingPatientId && (
        <RejectModal
          isOpen={!!rejectingPatientId}
          patientId={rejectingPatientId}
          onClose={() => setRejectingPatientId(null)}
          onConfirmReject={handleConfirmReject}
          isSubmitting={isRejecting}
        />
      )}
    </div>
  );
}

export default HospitalDashboardPage;
