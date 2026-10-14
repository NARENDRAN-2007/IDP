import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Eye, EyeOff, ArrowRight, Globe, Smartphone, Building2, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';

const QUICK_STAFF = [
  {
    id: 'H001',
    name: 'Apollo Hospital Greams Road',
    email: 'staff_h001@hospital.er',
    password: 'Password123!',
    label: 'Apollo Greams',
    icon: Globe
  },
  {
    id: 'H002',
    name: 'MGM Healthcare',
    email: 'staff_h002@hospital.er',
    password: 'Password123!',
    label: 'MGM Health',
    icon: Smartphone
  },
  {
    id: 'H003',
    name: 'Rajiv Gandhi Govt General Hospital',
    email: 'staff_h003@hospital.er',
    password: 'Password123!',
    label: 'RGGGH Trauma',
    icon: Building2
  }
];

export function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
      setLocation('/hospital');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSelect = (staff: typeof QUICK_STAFF[0]) => {
    setEmail(staff.email);
    setPassword(staff.password);
    setSelectedStationId(staff.id);
    setError(null);
  };

  return (
    <div className="min-h-screen w-full relative flex items-center justify-center p-4 sm:p-6 overflow-hidden bg-black select-none">
      {/* 1. Cinematic Hospital Emergency Trauma Center Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105 filter brightness-90 transition-all duration-700"
        style={{
          backgroundImage: "url('/hospital-er-bg.jpg')"
        }}
      />

      {/* Subtle Atmospheric Medical Tint & Vignette */}
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] pointer-events-none" />

      {/* 2. Centered Glassmorphic Floating Card */}
      <div className="relative z-10 w-full max-w-[420px] rounded-[36px] bg-white/[0.08] backdrop-blur-3xl border border-white/20 p-8 sm:p-10 shadow-[0_30px_70px_rgba(0,0,0,0.65)] shadow-black/80">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-sans">
            Sign in
          </h1>
          <p className="text-sm text-white/80 font-medium mt-1.5">
            Good to see you again.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 p-3 rounded-2xl bg-rose-500/25 border border-rose-400/40 text-white text-xs flex items-center gap-2 backdrop-blur-md">
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email input */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-1.5">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSelectedStationId(null);
              }}
              placeholder="you@hospital.er"
              className="w-full px-4 py-3 rounded-2xl bg-white/[0.12] hover:bg-white/[0.15] focus:bg-white/[0.18] border border-white/20 focus:border-white/50 text-white placeholder-white/40 text-sm outline-none transition duration-200 shadow-inner"
            />
          </div>

          {/* Password input with eye toggle */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setSelectedStationId(null);
                }}
                placeholder="••••••••••••"
                className="w-full pl-4 pr-11 py-3 rounded-2xl bg-white/[0.12] hover:bg-white/[0.15] focus:bg-white/[0.18] border border-white/20 focus:border-white/50 text-white placeholder-white/40 text-sm outline-none transition duration-200 shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember me and Forgot password row */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <label className="flex items-center gap-2 text-white/90 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded-md border border-white/30 bg-white/10 checked:bg-white checked:border-white accent-white cursor-pointer"
              />
              <span>Remember me</span>
            </label>

            <button
              type="button"
              onClick={() => alert('Demo stations use pre-seeded test passwords: Password123!')}
              className="text-white/85 hover:text-white underline font-medium transition"
            >
              Forgot password?
            </button>
          </div>

          {/* Solid White Sign In Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 py-3.5 px-6 rounded-2xl font-extrabold text-sm bg-white hover:bg-white/95 text-slate-950 shadow-xl shadow-black/40 flex items-center justify-center gap-2 transition duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          >
            <span>{isLoading ? 'Signing in...' : 'Sign in'}</span>
            <ArrowRight className="w-4 h-4 text-slate-950" />
          </button>
        </form>

        {/* Divider: or continue with */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/15" />
          </div>
          <span className="relative px-3 text-[11px] font-medium text-white/60 bg-transparent uppercase tracking-wider">
            or continue with
          </span>
        </div>

        {/* 3 Frosted Quick-Select Station Buttons */}
        <div className="grid grid-cols-3 gap-3">
          {QUICK_STAFF.map((staff) => {
            const Icon = staff.icon;
            const isSelected = selectedStationId === staff.id;

            return (
              <button
                key={staff.id}
                type="button"
                onClick={() => handleQuickSelect(staff)}
                title={`Autofill ${staff.name} (${staff.id})`}
                className={`py-3 px-2 rounded-2xl border transition duration-200 flex flex-col items-center justify-center gap-1.5 group ${
                  isSelected
                    ? 'bg-white/30 border-white text-white shadow-md'
                    : 'bg-white/[0.10] hover:bg-white/[0.20] border-white/20 text-white/85 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 text-white/90 group-hover:scale-110 transition duration-200" />
                <span className="text-[10px] font-bold tracking-tight truncate max-w-full">
                  {staff.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-7 text-center space-y-1.5">
          <p className="text-xs text-white/80 font-medium">
            New to platform?{' '}
            <button
              type="button"
              onClick={() => handleQuickSelect(QUICK_STAFF[0])}
              className="text-white font-extrabold underline hover:text-white/90 transition"
            >
              Demo credentials
            </button>
          </p>
          <p className="text-[11px] text-white/45 font-normal">
            Demo — authenticated against PostgreSQL.
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
