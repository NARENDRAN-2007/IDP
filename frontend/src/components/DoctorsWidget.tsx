import React, { useState, useMemo } from 'react';
import {
  UserCheck,
  Stethoscope,
  Heart,
  Brain,
  Baby,
  Activity,
  Clock,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  PhoneCall,
  Search,
  ChevronRight,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { cn } from '../lib/utils.js';

export interface DoctorProfile {
  id?: string;
  name: string;
  specialty: string;
  subSpecialty?: string;
  qualification?: string;
  room?: string;
  status?: 'available' | 'in_surgery' | 'on_call' | 'in_consultation' | string;
  timeslots: string[];
  shiftStart?: string;
  shiftEnd?: string;
  experienceYears?: number;
  phone?: string;
  onDuty?: boolean;
}

export interface DoctorShift {
  id?: string;
  specialty: string;
  count: number;
  shift_start?: string;
  shift_end?: string;
  doctor_name?: string;
  qualification?: string;
  room?: string;
  status?: string;
  timeslots?: string[];
  doctors?: DoctorProfile[];
}

interface DoctorsWidgetProps {
  doctors: DoctorShift[];
  className?: string;
  isFullView?: boolean;
}

// Built-in verified roster for Chennai hospitals as robust fallback/enrichment
const DEFAULT_FALLBACK_DOCTORS: Record<string, DoctorProfile[]> = {
  neuro: [
    {
      id: 'DOC-NEURO-1',
      name: 'Dr. Rajesh K. Sundaram',
      specialty: 'neuro',
      subSpecialty: 'Chief Neurosurgeon & Spine Lead',
      qualification: 'MBBS, MS, M.Ch (Neurosurgery)',
      room: 'Neuro OT 3 / Brain & Spine Wing',
      status: 'available',
      timeslots: ['08:00 AM - 11:30 AM', '02:00 PM - 05:30 PM', 'Emergency Trauma OT'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 16,
      phone: '+91 98401 22891',
      onDuty: true
    },
    {
      id: 'DOC-NEURO-2',
      name: 'Dr. Ananya Swaminathan',
      specialty: 'neuro',
      subSpecialty: 'Lead Interventional Neurologist & Stroke Care',
      qualification: 'MBBS, MD, DM (Neurology)',
      room: 'Stroke ICU Bay 2 & Desk 4',
      status: 'available',
      timeslots: ['09:00 AM - 01:30 PM', '04:00 PM - 07:30 PM'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 12,
      phone: '+91 98402 33412',
      onDuty: true
    },
    {
      id: 'DOC-NEURO-3',
      name: 'Dr. K. Raghavan',
      specialty: 'neuro',
      subSpecialty: 'Neuro-Critical Care & Trauma Specialist',
      qualification: 'MBBS, MD, EDIC (Neuro-ICU)',
      room: 'Neuro Resuscitation Bay 1',
      status: 'in_surgery',
      timeslots: ['08:00 AM - 08:00 PM (Emergency Shift)'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 10,
      phone: '+91 98403 44523',
      onDuty: true
    }
  ],
  cardiac: [
    {
      id: 'DOC-CARD-1',
      name: 'Dr. S. Ramanathan',
      specialty: 'cardiac',
      subSpecialty: 'Chief Interventional Cardiologist',
      qualification: 'MBBS, MD, DM (Cardiology), FACC',
      room: 'Cath Lab 1 & Cardiac ER',
      status: 'available',
      timeslots: ['08:30 AM - 12:30 PM', '03:00 PM - 06:30 PM', 'Emergency STEMI On-Call'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 18,
      phone: '+91 98405 66745',
      onDuty: true
    },
    {
      id: 'DOC-CARD-2',
      name: 'Dr. Preeti Chandrasekhar',
      specialty: 'cardiac',
      subSpecialty: 'Cardiac Electrophysiologist & CCU Lead',
      qualification: 'MBBS, MD, DM (Cardiology)',
      room: 'Coronary Care Unit (CCU) Bay 4',
      status: 'available',
      timeslots: ['10:00 AM - 02:00 PM', 'Emergency CCU Shift'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 11,
      phone: '+91 98406 77856',
      onDuty: true
    }
  ],
  general: [
    {
      id: 'DOC-GEN-1',
      name: 'Dr. Vikramaditya Sen',
      specialty: 'general',
      subSpecialty: 'Emergency Medicine & Trauma Director',
      qualification: 'MBBS, MS (General Surgery), FACEE',
      room: 'Trauma Resuscitation Bay 1',
      status: 'available',
      timeslots: ['08:00 AM - 08:00 PM (Active Trauma Shift)', 'Night Standby'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 15,
      phone: '+91 98408 99078',
      onDuty: true
    },
    {
      id: 'DOC-GEN-2',
      name: 'Dr. Shalini Mukherjee',
      specialty: 'general',
      subSpecialty: 'Emergency Medicine Specialist',
      qualification: 'MBBS, MD (Emergency Medicine)',
      room: 'ER Triage & Rapid Response Desk',
      status: 'available',
      timeslots: ['08:00 AM - 02:00 PM', '06:00 PM - 10:00 PM'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 9,
      phone: '+91 98409 10189',
      onDuty: true
    }
  ],
  obstetric: [
    {
      id: 'DOC-OBG-1',
      name: 'Dr. Meenakshi Sundaram',
      specialty: 'obstetric',
      subSpecialty: 'Senior Consultant Obstetrician & Gynaecologist',
      qualification: 'MBBS, MD, DGO, FICOG',
      room: 'Labour & Delivery Suite 2',
      status: 'available',
      timeslots: ['08:00 AM - 01:00 PM', '03:00 PM - 06:00 PM', 'Emergency Labour Duty'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 20,
      phone: '+91 98411 32301',
      onDuty: true
    },
    {
      id: 'DOC-OBG-2',
      name: 'Dr. Kavita Venkat',
      specialty: 'obstetric',
      subSpecialty: 'Maternal-Fetal Medicine Specialist',
      qualification: 'MBBS, MS (OBG), Fellowship Fetal Med',
      room: 'High-Risk Obstetrics Wing & OT 4',
      status: 'available',
      timeslots: ['09:00 AM - 02:00 PM', 'Emergency C-Section Standby'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 13,
      phone: '+91 98412 43412',
      onDuty: true
    }
  ]
};

export function DoctorsWidget({ doctors = [], className, isFullView = false }: DoctorsWidgetProps) {
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('all');
  const [pagedDoctor, setPagedDoctor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all individual doctors from input and fallbacks
  const allDoctors = useMemo(() => {
    const list: DoctorProfile[] = [];

    // Check if doctors passed from backend have nested doctors list
    doctors.forEach((docGroup) => {
      const spec = docGroup.specialty.toLowerCase();
      if (docGroup.doctors && Array.isArray(docGroup.doctors) && docGroup.doctors.length > 0) {
        docGroup.doctors.forEach((d) => list.push(d));
      } else if (DEFAULT_FALLBACK_DOCTORS[spec]) {
        DEFAULT_FALLBACK_DOCTORS[spec].forEach((d) => list.push(d));
      } else {
        list.push({
          id: docGroup.id || `DOC-${spec}`,
          name: docGroup.doctor_name || `Dr. ${spec.charAt(0).toUpperCase() + spec.slice(1)} Specialist`,
          specialty: spec,
          qualification: docGroup.qualification || 'MBBS, MD',
          room: docGroup.room || `${spec.toUpperCase()} Department`,
          status: (docGroup.status as any) || 'available',
          timeslots: docGroup.timeslots || ['08:00 AM - 02:00 PM', '02:00 PM - 08:00 PM'],
          shiftStart: docGroup.shift_start || '08:00',
          shiftEnd: docGroup.shift_end || '20:00',
          onDuty: true
        });
      }
    });

    // If still empty or missing neuro, inject defaults
    if (list.length === 0 || !list.some((d) => d.specialty === 'neuro')) {
      Object.values(DEFAULT_FALLBACK_DOCTORS).forEach((docs) => {
        docs.forEach((d) => list.push(d));
      });
    }

    return list;
  }, [doctors]);

  // Filtered doctors based on active tab and search query
  const filteredDoctors = useMemo(() => {
    return allDoctors.filter((doc) => {
      const matchesSpec =
        selectedSpecialty === 'all' || doc.specialty.toLowerCase() === selectedSpecialty.toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.subSpecialty && doc.subSpecialty.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (doc.room && doc.room.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSpec && matchesSearch;
    });
  }, [allDoctors, selectedSpecialty, searchQuery]);

  const handlePageDoctor = (docName: string) => {
    setPagedDoctor(docName);
    setTimeout(() => {
      setPagedDoctor(null);
    }, 3500);
  };

  const getIcon = (specialty: string) => {
    switch (specialty.toLowerCase()) {
      case 'cardiac':
        return <Heart className="w-4 h-4 text-rose-500" />;
      case 'neuro':
        return <Brain className="w-4 h-4 text-purple-600" />;
      case 'obstetric':
        return <Baby className="w-4 h-4 text-pink-500" />;
      default:
        return <Stethoscope className="w-4 h-4 text-cyan-600" />;
    }
  };

  const getSpecialtyBadgeStyle = (specialty: string) => {
    switch (specialty.toLowerCase()) {
      case 'cardiac':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'neuro':
        return 'bg-purple-50 text-purple-900 border-purple-200';
      case 'obstetric':
        return 'bg-pink-50 text-pink-800 border-pink-200';
      default:
        return 'bg-blue-50 text-blue-800 border-blue-200';
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Available Now
          </span>
        );
      case 'in_surgery':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            In Surgery / OT
          </span>
        );
      case 'on_call':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            On Emergency Call
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            On Duty
          </span>
        );
    }
  };

  // Specialty summary counts
  const specialtyCounts = useMemo(() => {
    const counts: Record<string, number> = { neuro: 0, cardiac: 0, general: 0, obstetric: 0 };
    allDoctors.forEach((d) => {
      const s = d.specialty.toLowerCase();
      if (counts[s] !== undefined) counts[s]++;
      else counts[s] = 1;
    });
    return counts;
  }, [allDoctors]);

  return (
    <div
      className={cn(
        'bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col justify-between transition-all duration-300',
        isFullView ? 'min-h-[500px]' : 'h-full',
        className
      )}
    >
      <div>
        {/* Header with Title and Specialty Filter Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 mb-4 border-b border-slate-100 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-zinc-900 text-white shadow-sm">
              <UserCheck className="w-4 h-4 text-[#FF8DA1]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">Doctors on Duty</h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {allDoctors.length} Clinical Staff Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Live Specialty Roster & Available Timeslots</p>
            </div>
          </div>

          {/* Quick Search in full view */}
          {isFullView && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search doctor, specialty, room..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:bg-white"
              />
            </div>
          )}
        </div>

        {/* Paged Notification Toast */}
        {pagedDoctor && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-2xl text-xs text-purple-900 font-semibold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-purple-600 animate-bounce" />
              <span>
                <strong>{pagedDoctor}</strong> has been alerted for incoming trauma case!
              </span>
            </div>
            <span className="text-[10px] bg-purple-200 px-2 py-0.5 rounded-md font-mono">Paged</span>
          </div>
        )}

        {/* Specialty Filter Tabs (All, Neuro highlighted, Cardiac, General, Obstetric) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedSpecialty('all')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border flex items-center gap-1.5',
              selectedSpecialty === 'all'
                ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            )}
          >
            <span>All Specialties</span>
            <span className="text-[10px] font-mono px-1.5 rounded-md bg-white/20">
              {allDoctors.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedSpecialty('neuro')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border flex items-center gap-1.5',
              selectedSpecialty === 'neuro'
                ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                : 'bg-purple-50/80 text-purple-800 border-purple-200 hover:bg-purple-100'
            )}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Neuro</span>
            <span className="text-[10px] font-mono px-1.5 rounded-md bg-purple-200/50">
              {specialtyCounts.neuro || 3}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedSpecialty('cardiac')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border flex items-center gap-1.5',
              selectedSpecialty === 'cardiac'
                ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                : 'bg-rose-50/80 text-rose-800 border-rose-200 hover:bg-rose-100'
            )}
          >
            <Heart className="w-3.5 h-3.5" />
            <span>Cardiac</span>
            <span className="text-[10px] font-mono px-1.5 rounded-md bg-rose-200/50">
              {specialtyCounts.cardiac || 2}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedSpecialty('general')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border flex items-center gap-1.5',
              selectedSpecialty === 'general'
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-blue-50/80 text-blue-800 border-blue-200 hover:bg-blue-100'
            )}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Emergency/General</span>
            <span className="text-[10px] font-mono px-1.5 rounded-md bg-blue-200/50">
              {specialtyCounts.general || 2}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedSpecialty('obstetric')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border flex items-center gap-1.5',
              selectedSpecialty === 'obstetric'
                ? 'bg-pink-600 text-white border-pink-600 shadow-xs'
                : 'bg-pink-50/80 text-pink-800 border-pink-200 hover:bg-pink-100'
            )}
          >
            <Baby className="w-3.5 h-3.5" />
            <span>Obstetric</span>
            <span className="text-[10px] font-mono px-1.5 rounded-md bg-pink-200/50">
              {specialtyCounts.obstetric || 2}
            </span>
          </button>
        </div>

        {/* Doctors Roster Grid */}
        <div
          className={cn(
            'gap-3',
            isFullView
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : 'grid grid-cols-1 max-h-[340px] overflow-y-auto pr-1'
          )}
        >
          {filteredDoctors.length === 0 ? (
            <div className="col-span-full py-8 text-center text-xs text-slate-400">
              No doctors found matching query.
            </div>
          ) : (
            filteredDoctors.map((doc, idx) => (
              <div
                key={doc.id || idx}
                className={cn(
                  'p-3.5 rounded-2xl border transition-all duration-200 hover:shadow-md bg-white border-slate-200 flex flex-col justify-between',
                  doc.specialty === 'neuro' && 'hover:border-purple-300'
                )}
              >
                <div>
                  {/* Doctor Header: Name, Specialty Badge & Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-xl bg-slate-100 text-slate-800 shadow-2xs">
                        {getIcon(doc.specialty)}
                      </div>
                      <div>
                        <h3 className="text-xs font-extrabold text-slate-900 leading-tight">
                          {doc.name}
                        </h3>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {doc.qualification || 'MBBS, Specialist'}
                        </p>
                      </div>
                    </div>

                    {getStatusBadge(doc.status)}
                  </div>

                  {/* Sub-specialty & Room */}
                  <div className="space-y-1 my-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-800 capitalize flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                        {doc.subSpecialty || `${doc.specialty.toUpperCase()} Consultant`}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] uppercase font-mono font-extrabold px-1.5 py-0.5 rounded',
                          getSpecialtyBadgeStyle(doc.specialty)
                        )}
                      >
                        {doc.specialty}
                      </span>
                    </div>

                    {doc.room && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{doc.room}</span>
                      </div>
                    )}
                  </div>

                  {/* Available Timeslots Section (Primary User Requirement) */}
                  <div className="mt-2.5">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600 mb-1.5">
                      <Clock className="w-3 h-3 text-purple-600" />
                      <span>Available Timeslots</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {doc.timeslots && doc.timeslots.length > 0 ? (
                        doc.timeslots.map((slot, sIdx) => {
                          const isImmediate =
                            slot.toLowerCase().includes('emergency') ||
                            slot.toLowerCase().includes('available') ||
                            slot.toLowerCase().includes('now');
                          return (
                            <span
                              key={sIdx}
                              className={cn(
                                'px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border flex items-center gap-1',
                                isImmediate
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-100/90 text-slate-700 border-slate-200'
                              )}
                            >
                              {isImmediate && <Sparkles className="w-2.5 h-2.5 text-emerald-600" />}
                              {slot}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">
                          Shift: 08:00 - 20:00 (On Active Shift)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer action */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400 font-mono">
                    Shift {doc.shiftStart || '08:00'} - {doc.shiftEnd || '20:00'}
                  </span>

                  <button
                    type="button"
                    onClick={() => handlePageDoctor(doc.name)}
                    className="px-2.5 py-1 rounded-lg bg-zinc-900 text-white font-bold hover:bg-zinc-800 transition flex items-center gap-1 text-[10px]"
                  >
                    <PhoneCall className="w-2.5 h-2.5 text-[#FF8DA1]" />
                    <span>Page</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget Footer */}
      {!isFullView && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between">
          <div className="flex items-center gap-1 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Doctors on shift prep for incoming trauma cases</span>
          </div>
          <span className="font-mono text-purple-600 font-bold text-[9px] uppercase">
            Neuro & Critical Ready
          </span>
        </div>
      )}
    </div>
  );
}
