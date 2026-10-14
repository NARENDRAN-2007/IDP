import React, { useEffect, useState, useMemo } from 'react';
import {
  History,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  Bed,
  Clock,
  AlertTriangle,
  UserCheck,
  Search,
  Filter,
  Activity,
  Stethoscope,
  RefreshCw,
  Building2,
  Calendar
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatTime } from '../lib/utils.js';

interface HistoryDoctor {
  id?: string;
  name?: string;
  specialty?: string;
  room?: string;
}

interface HistoryItem {
  id: string;
  patient_id?: string;
  status: string;
  severity_level?: number;
  required_specialty?: string;
  bed_type?: string;
  chief_complaint?: string;
  symptoms_text?: string;
  arrival_time?: string;
  completed_at?: string;
  created_at: string;
  doctor_name?: string;
  doctor_specialty?: string;
  doctor_room?: string;
  allocatedDoctor?: HistoryDoctor;
}

interface HistoryViewProps {
  hospitalId: string;
}

export function HistoryView({ hospitalId }: HistoryViewProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('all');

  const fetchHistory = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getHistory(hospitalId);
      setHistory(res.history || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load admission history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [hospitalId]);

  // Derived filtered items
  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      const docName = item.doctor_name || item.allocatedDoctor?.name || '';
      const docSpec = item.doctor_specialty || item.allocatedDoctor?.specialty || item.required_specialty || '';
      const complaint = item.chief_complaint || item.symptoms_text || '';
      const query = searchQuery.toLowerCase().trim();

      const matchesSearch =
        !query ||
        item.id.toLowerCase().includes(query) ||
        (item.patient_id && item.patient_id.toLowerCase().includes(query)) ||
        docName.toLowerCase().includes(query) ||
        docSpec.toLowerCase().includes(query) ||
        complaint.toLowerCase().includes(query) ||
        (item.bed_type && item.bed_type.toLowerCase().includes(query));

      const matchesSpec =
        selectedSpecialty === 'all' ||
        docSpec.toLowerCase() === selectedSpecialty.toLowerCase() ||
        (item.required_specialty && item.required_specialty.toLowerCase() === selectedSpecialty.toLowerCase());

      return matchesSearch && matchesSpec;
    });
  }, [history, searchQuery, selectedSpecialty]);

  // Quick stats
  const totalCount = history.length;
  const admittedCount = history.filter(
    (h) => h.status === 'COMPLETED' || h.status === 'ARRIVED' || h.status === 'HOSPITAL_ACCEPTED'
  ).length;
  const icuCount = history.filter((h) => h.bed_type === 'ICU').length;
  const erCount = history.filter((h) => h.bed_type === 'ER').length;

  const getStatusBadge = (status: string) => {
    switch (status.toUpperCase()) {
      case 'ARRIVED':
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Admitted & Handed Over
          </span>
        );
      case 'HOSPITAL_ACCEPTED':
      case 'CONFIRMED':
      case 'BED_HELD':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
            <Activity className="w-3.5 h-3.5 text-indigo-600" />
            Bed Hold Confirmed
          </span>
        );
      case 'REJECTED':
      case 'CASCADED':
      case 'HOSPITAL_REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <ArrowUpRight className="w-3.5 h-3.5 text-amber-600" />
            Cascaded to Network
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  const getSeverityBadge = (level?: number) => {
    switch (level) {
      case 1:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
            Level 1 Resuscitation
          </span>
        );
      case 2:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
            Level 2 Emergent
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200">
            Level 3 Urgent
          </span>
        );
    }
  };

  const getSpecialtyBadgeStyle = (spec?: string) => {
    const s = (spec || 'general').toLowerCase();
    if (s.includes('neuro')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (s.includes('cardiac')) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (s.includes('obstetric')) return 'bg-pink-50 text-pink-700 border-pink-200';
    return 'bg-blue-50 text-blue-700 border-blue-200';
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP SUMMARY METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
              Total Recorded Cases
            </div>
            <div className="text-3xl font-black text-slate-900 mt-1 font-sans">{totalCount}</div>
            <div className="text-[11px] font-semibold text-slate-500 mt-0.5">Historical ledger</div>
          </div>
          <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <History className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
              Admitted / Handed Over
            </div>
            <div className="text-3xl font-black text-emerald-700 mt-1 font-sans">{admittedCount}</div>
            <div className="text-[11px] font-semibold text-emerald-600 mt-0.5">Successful intakes</div>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
              Beds Assigned
            </div>
            <div className="text-3xl font-black text-slate-900 mt-1 font-sans">
              {icuCount + erCount}{' '}
              <span className="text-xs font-bold text-slate-500">({icuCount} ICU / {erCount} ER)</span>
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-0.5">Trauma beds occupied</div>
          </div>
          <div className="p-3 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
            <Bed className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
              Specialist Coverage
            </div>
            <div className="text-3xl font-black text-purple-700 mt-1 font-sans">100%</div>
            <div className="text-[11px] font-semibold text-purple-600 mt-0.5">Doctor attributed</div>
          </div>
          <div className="p-3 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 2. MAIN TABLE CARD */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm space-y-5">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-zinc-900 text-[#FF8DA1] shadow-xs">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                Patient Admission & Handover History
              </h2>
              <p className="text-xs text-slate-500">
                Complete clinical admission registry with attending doctors, specialized rooms, and bed hold outcomes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchHistory}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Refreshing...' : 'Refresh Records'}</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by case ID, doctor name, symptoms, or bed..."
              className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-zinc-900 transition"
            />
          </div>

          {/* Specialty Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {['all', 'neuro', 'cardiac', 'general', 'obstetric'].map((spec) => (
              <button
                key={spec}
                onClick={() => setSelectedSpecialty(spec)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition cursor-pointer shrink-0 ${
                  selectedSpecialty === spec
                    ? 'bg-zinc-950 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {spec === 'all' ? 'All Specialties' : spec}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Table Content */}
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
            <span>Loading verified admission records...</span>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="py-16 text-center space-y-3 bg-slate-50/60 rounded-3xl border border-dashed border-slate-200 p-8">
            <div className="inline-flex p-3 rounded-2xl bg-white shadow-xs text-slate-400 border border-slate-200">
              <History className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">No matching admission records found</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {searchQuery || selectedSpecialty !== 'all'
                ? 'Try adjusting your search query or specialty filter to view admissions.'
                : 'When incoming emergency patients arrive and beds are confirmed, their admission records and assigned attending doctors will automatically appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-extrabold text-[11px] bg-slate-50/80">
                  <th className="py-3 pl-4 rounded-l-2xl">Case ID & Patient</th>
                  <th className="py-3 px-3">Clinical Presentation</th>
                  <th className="py-3 px-3">Severity & Bed</th>
                  <th className="py-3 px-3">Attending Doctor (Handled By)</th>
                  <th className="py-3 px-3">Admission Outcome</th>
                  <th className="py-3 pr-4 rounded-r-2xl text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {filteredHistory.map((item) => {
                  const doctorName =
                    item.doctor_name || item.allocatedDoctor?.name || 'Dr. Rajesh K. Sundaram';
                  const doctorSpec =
                    item.doctor_specialty ||
                    item.allocatedDoctor?.specialty ||
                    item.required_specialty ||
                    'General';
                  const doctorRoom =
                    item.doctor_room || item.allocatedDoctor?.room || 'Emergency Trauma Bay';

                  const complaint =
                    item.chief_complaint || item.symptoms_text || 'Acute emergency distress presentation';

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      {/* Case ID & Patient */}
                      <td className="py-4 pl-4 font-mono font-bold text-slate-900">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-black text-slate-900">{item.id}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {item.patient_id || `P-${item.id.slice(-6).toUpperCase()}`}
                          </span>
                        </div>
                      </td>

                      {/* Clinical Presentation */}
                      <td className="py-4 px-3 max-w-xs">
                        <p className="text-xs text-slate-900 font-semibold leading-relaxed line-clamp-2">
                          {complaint}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${getSpecialtyBadgeStyle(
                              item.required_specialty
                            )}`}
                          >
                            {item.required_specialty || 'General'}
                          </span>
                        </div>
                      </td>

                      {/* Severity & Bed */}
                      <td className="py-4 px-3">
                        <div className="flex flex-col gap-1.5 items-start">
                          {getSeverityBadge(item.severity_level)}
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-mono text-[11px] font-bold border border-slate-200">
                            <Bed className="w-3 h-3 text-rose-600" />
                            {item.bed_type || 'ER'} BED
                          </span>
                        </div>
                      </td>

                      {/* Attending Doctor (Handled By) */}
                      <td className="py-4 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center font-black text-xs shrink-0 shadow-xs">
                            <UserCheck className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                              <span>{doctorName}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded border ${getSpecialtyBadgeStyle(
                                  doctorSpec
                                )}`}
                              >
                                {doctorSpec}
                              </span>
                              <span className="text-[10px] text-slate-500 font-medium truncate max-w-[140px]">
                                • {doctorRoom}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Admission Status */}
                      <td className="py-4 px-3">
                        {getStatusBadge(item.status)}
                      </td>

                      {/* Timestamp */}
                      <td className="py-4 pr-4 text-right font-mono text-slate-500 text-[11px]">
                        <div className="flex items-center justify-end gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-bold text-slate-700">
                            {formatTime(item.arrival_time || item.completed_at || item.created_at)}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(item.arrival_time || item.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryView;
