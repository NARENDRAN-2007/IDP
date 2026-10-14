import React, { useState, useEffect } from 'react';
import { Timer, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface CountdownProps {
  expiresAt?: string | Date | null;
  onExpire?: () => void;
  className?: string;
}

export function Countdown({ expiresAt, onExpire, className }: CountdownProps) {
  const calculateRemaining = () => {
    if (!expiresAt) return 0;
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  };

  const [remaining, setRemaining] = useState(calculateRemaining);

  useEffect(() => {
    setRemaining(calculateRemaining());

    const timer = setInterval(() => {
      const sec = calculateRemaining();
      setRemaining(sec);
      if (sec === 0) {
        if (onExpire) onExpire();
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  if (!expiresAt) {
    return null;
  }

  const isUrgent = remaining <= 10 && remaining > 0;
  const isExpired = remaining === 0;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-tight transition-all duration-300 font-mono shadow-xs',
        isExpired
          ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
          : isUrgent
          ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse'
          : 'bg-emerald-100 text-emerald-900 border border-emerald-300',
        className
      )}
    >
      {isExpired ? (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>HOLD EXPIRED / CASCADING</span>
        </>
      ) : (
        <>
          <Timer className={cn('w-3.5 h-3.5', isUrgent ? 'text-amber-600' : 'text-emerald-600')} />
          <span>{remaining}s HOLD TIMER</span>
        </>
      )}
    </div>
  );
}
