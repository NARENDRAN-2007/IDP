import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertCircle, ArrowRight } from 'lucide-react';

interface RejectModalProps {
  isOpen: boolean;
  patientId: string;
  onClose: () => void;
  onConfirmReject: (reason: string) => Promise<void>;
  isSubmitting?: boolean;
}

const QUICK_REASONS = [
  'ER resuscitation bays at full emergency capacity',
  'All ventilators and critical care beds occupied',
  'CT scanner undergoing emergency recalibration',
  'Specialist surgical team currently occupied in OR',
  'Severe staffing constraint on current shift'
];

export function RejectModal({
  isOpen,
  patientId,
  onClose,
  onConfirmReject,
  isSubmitting = false
}: RejectModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A mandatory reason is required to reject an emergency hold');
      return;
    }
    setError('');
    await onConfirmReject(reason.trim());
    setReason('');
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg p-6 rounded-3xl bg-white border border-slate-100 shadow-2xl z-50 focus:outline-none">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2 text-rose-600 font-bold text-base">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <span>Reject Patient & Cascade to Next Hospital</span>
            </div>
            <Dialog.Close asChild>
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Rejecting request <span className="font-mono font-bold text-slate-800">{patientId}</span> will immediately release the provisional bed hold and trigger an automated Haversine/ORS cascade to the next nearest facility in Chennai.
          </p>

          {error && (
            <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Reason for Rejection (Mandatory)
              </label>
              <textarea
                rows={3}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="State clinical or operational justification..."
                className="w-full p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              />
            </div>

            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Quick Justifications:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REASONS.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setReason(r)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Cascading...' : 'Confirm Rejection'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
