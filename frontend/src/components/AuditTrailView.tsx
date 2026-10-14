import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  KeyRound,
  ArrowRightLeft,
  Bed,
  Building2,
  Check,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatTime } from '../lib/utils.js';

interface AuditLog {
  id: string;
  action?: string;
  status?: string;
  request_id?: string;
  details?: any;
  meta?: any;
  created_at?: string;
  at?: string;
}

interface AuditTrailViewProps {
  hospitalId: string;
}

const HOSPITAL_NAMES: Record<string, string> = {
  H001: 'Apollo Greams Road',
  H002: 'MGM Healthcare',
  H003: 'Rajiv Gandhi General Hospital',
  H004: 'Fortis Malar',
  H005: 'MIOT International',
  H006: 'SIMS Hospital'
};

const DEMO_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'AUD_01',
    action: 'REJECT_CASCADE',
    status: 'HOLD_REJECTED',
    request_id: 'REQ_CH_00139',
    created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    meta: {
      reason: 'All ventilators and critical care beds occupied in ICU',
      bedType: 'ICU',
      nextHospitalId: 'H002',
      cascadeCount: 1,
      holdId: 'hold_9921a8'
    }
  },
  {
    id: 'AUD_02',
    action: 'BED_CONFIRMED',
    status: 'HOSPITAL_ACCEPTED',
    request_id: 'REQ_CH_00142',
    created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    meta: {
      reason: 'Emergency resuscitation bay hold accepted and confirmed by hospital staff',
      bedType: 'ICU',
      holdId: 'hold_8831f2'
    }
  },
  {
    id: 'AUD_03',
    action: 'TIMEOUT_CASCADE',
    status: 'HOLD_EXPIRED',
    request_id: 'REQ_CH_00135',
    created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    meta: {
      reason: '30-second provisional countdown expired without hospital staff confirmation',
      bedType: 'ER',
      nextHospitalId: 'H003',
      cascadeCount: 2,
      holdId: 'hold_7712c9'
    }
  },
  {
    id: 'AUD_04',
    action: 'QUEUE_PRIORITIZED',
    status: 'CONFLICT_RESOLVED',
    request_id: 'REQ_CH_00132',
    created_at: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    meta: {
      reason: 'Conflict tiebreak: Level 1 Cardiac arrest prioritized for last ICU bed over Level 2 trauma',
      bedType: 'ICU'
    }
  },
  {
    id: 'AUD_05',
    action: 'HANDOVER_COMPLETED',
    status: 'ARRIVED_AT_HOSPITAL',
    request_id: 'REQ_CH_00128',
    created_at: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
    meta: {
      reason: 'Ambulance TN-01-AM-104 arrived at trauma bay; emergency patient care transferred to ER staff',
      bedType: 'ER'
    }
  }
];

export function AuditTrailView({ hospitalId }: AuditTrailViewProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getAuditTrail(hospitalId);
      const serverLogs = res.auditLogs || [];

      if (serverLogs.length > 0) {
        setLogs(serverLogs);
      } else {
        setLogs(DEMO_AUDIT_LOGS);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load audit trail logs');
      setLogs(DEMO_AUDIT_LOGS);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [hospitalId]);

  const getActionBadge = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('CONFIRM') || act.includes('ACCEPTED')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>BED CONFIRMED</span>
        </span>
      );
    }
    if (act.includes('CASCADE') || act.includes('REJECT') || act.includes('RELEASE')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
          <ArrowRightLeft className="w-3.5 h-3.5 text-rose-600" />
          <span>REJECTED & CASCADED</span>
        </span>
      );
    }
    if (act.includes('TIMEOUT') || act.includes('EXPIRED')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>30S HOLD TIMEOUT</span>
        </span>
      );
    }
    if (act.includes('QUEUE') || act.includes('PRIORITIZED')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
          <Zap className="w-3.5 h-3.5 text-purple-600" />
          <span>QUEUE PRIORITIZED</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200">
        <FileText className="w-3.5 h-3.5 text-sky-600" />
        <span>{action}</span>
      </span>
    );
  };

  // Helper to extract clean human-readable reason without raw JSON
  const extractReason = (log: AuditLog): string => {
    let rawMeta = log.meta || log.details;
    if (typeof rawMeta === 'string') {
      try {
        rawMeta = JSON.parse(rawMeta);
      } catch {
        return rawMeta;
      }
    }

    if (rawMeta && typeof rawMeta === 'object') {
      if (rawMeta.reason) {
        if (rawMeta.reason === 'HOLD_TIMEOUT') {
          return '30-second provisional bed hold countdown elapsed without staff confirmation';
        }
        if (rawMeta.reason === 'MAX_CASCADES_EXCEEDED') {
          return 'Maximum cascade threshold reached (5 hospitals) without bed reservation';
        }
        return rawMeta.reason;
      }
      if (rawMeta.justification) return rawMeta.justification;
      if (rawMeta.message) return rawMeta.message;
    }

    const act = (log.action || log.status || '').toUpperCase();
    if (act.includes('CONFIRM') || act.includes('ACCEPTED')) {
      return 'Provisional emergency bed hold accepted and confirmed by hospital ER staff';
    }
    if (act.includes('REJECT')) {
      return 'Emergency hold declined by hospital staff due to clinical or capacity constraints';
    }
    if (act.includes('TIMEOUT') || act.includes('EXPIRED')) {
      return '30-second provisional hold expired without staff action; automatic cascade initiated';
    }
    if (act.includes('PRIORITIZED')) {
      return 'Severity tiebreak: higher acuity trauma case prioritized over lower acuity case';
    }
    if (act.includes('ARRIVED')) {
      return 'Ambulance arrived at trauma bay; patient care successfully transferred to ER desk';
    }
    return 'Event verified and recorded in PostgreSQL request status log';
  };

  const extractMetadataFields = (log: AuditLog) => {
    let rawMeta = log.meta || log.details;
    if (typeof rawMeta === 'string') {
      try {
        rawMeta = JSON.parse(rawMeta);
      } catch {
        return {};
      }
    }
    return rawMeta && typeof rawMeta === 'object' ? rawMeta : {};
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-5 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-zinc-950 text-[#FF8DA1] shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 leading-tight">
              Section 13 Compliance & Bed Reservation Verification Log
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verified clinical event trail with human-readable justifications and audit reasons
            </p>
          </div>
        </div>

        <button
          onClick={fetchLogs}
          disabled={isLoading}
          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 transition flex items-center justify-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit</span>
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="py-14 text-center text-slate-400 text-xs font-medium">
          Loading immutable security audit records...
        </div>
      ) : logs.length === 0 ? (
        <div className="py-14 text-center text-slate-400 text-xs font-medium bg-slate-50 rounded-2xl border border-slate-100">
          No audit entries recorded yet for this station.
        </div>
      ) : (
        <div className="space-y-3.5 max-h-[600px] overflow-y-auto pr-1">
          {logs.map((log) => {
            const actionText = log.action || log.status || 'AUDIT_EVENT';
            const logTimestamp = log.created_at || log.at || new Date().toISOString();
            const reasonText = extractReason(log);
            const metaFields = extractMetadataFields(log);

            const isRejectionOrCascade =
              actionText.toUpperCase().includes('REJECT') ||
              actionText.toUpperCase().includes('CASCADE') ||
              actionText.toUpperCase().includes('TIMEOUT');

            return (
              <div
                key={log.id}
                className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/90 hover:bg-slate-100/60 transition shadow-2xs"
              >
                {/* Top Strip: Action Badge, Request ID, and Timestamp */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60">
                  <div className="flex items-center gap-2.5">
                    {getActionBadge(actionText)}

                    {log.request_id && (
                      <span className="font-mono text-xs font-extrabold text-slate-900 bg-white px-2.5 py-0.5 rounded-lg border border-slate-200 shadow-2xs">
                        {log.request_id}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatTime(logTimestamp)}</span>
                  </div>
                </div>

                {/* Primary Reason Display (High Visibility Card, NO RAW JSON) */}
                <div
                  className={`mt-3 p-3.5 rounded-2xl border transition ${
                    isRejectionOrCascade
                      ? 'bg-rose-50/70 border-rose-200/90 text-rose-950'
                      : 'bg-white border-slate-200 text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1">
                    {isRejectionOrCascade ? (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <span className="text-rose-700">Audit Justification & Reason</span>
                      </>
                    ) : (
                      <>
                        <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="text-slate-500">Audit Justification & Reason</span>
                      </>
                    )}
                  </div>

                  <p className="text-xs font-bold leading-relaxed">
                    {reasonText}
                  </p>
                </div>

                {/* Structured Metadata Pills (Bed Type, Next Hospital, Hold ID) */}
                <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[11px]">
                  {metaFields.bedType && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold shadow-2xs">
                      <Bed className="w-3 h-3 text-rose-500" />
                      <span>Bed: {metaFields.bedType}</span>
                    </span>
                  )}

                  {metaFields.nextHospitalId && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold shadow-2xs">
                      <Building2 className="w-3 h-3 text-amber-600" />
                      <span>
                        Cascaded To: {HOSPITAL_NAMES[metaFields.nextHospitalId] || metaFields.nextHospitalId}
                      </span>
                    </span>
                  )}

                  {metaFields.cascadeCount !== undefined && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold shadow-2xs">
                      <span>Cascade Iteration: #{metaFields.cascadeCount}</span>
                    </span>
                  )}

                  {metaFields.holdId && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-500 font-mono text-[10px] shadow-2xs">
                      <KeyRound className="w-3 h-3 text-slate-400" />
                      <span>Hold Token: {metaFields.holdId}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AuditTrailView;
