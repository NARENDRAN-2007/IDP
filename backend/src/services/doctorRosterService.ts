export interface DoctorProfile {
  id: string;
  name: string;
  specialty: 'neuro' | 'cardiac' | 'general' | 'obstetric';
  subSpecialty: string;
  qualification: string;
  room: string;
  status: 'available' | 'in_surgery' | 'on_call' | 'in_consultation';
  timeslots: string[];
  shiftStart: string;
  shiftEnd: string;
  experienceYears: number;
  phone: string;
  onDuty: boolean;
}

export interface DoctorSpecialtyGroup {
  specialty: string;
  count: number;
  shift_start: string;
  shift_end: string;
  doctor_name: string;
  qualification: string;
  room: string;
  status: string;
  timeslots: string[];
  doctors: DoctorProfile[];
}

const MASTER_DOCTOR_ROSTER: Record<string, DoctorProfile[]> = {
  neuro: [
    {
      id: 'DOC-NEURO-01',
      name: 'Dr. Rajesh K. Sundaram',
      specialty: 'neuro',
      subSpecialty: 'Senior Consultant Neurosurgeon',
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
      id: 'DOC-NEURO-02',
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
      id: 'DOC-NEURO-03',
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
    },
    {
      id: 'DOC-NEURO-04',
      name: 'Dr. Priya S. Chandran',
      specialty: 'neuro',
      subSpecialty: 'Pediatric Neurologist & Neuro-Oncologist',
      qualification: 'MBBS, DNB (Pediatrics), DM (Neuro)',
      room: 'Pediatric Neuro Wing, OPD 204',
      status: 'on_call',
      timeslots: ['11:00 AM - 03:00 PM', 'Emergency On-Call'],
      shiftStart: '20:00',
      shiftEnd: '08:00',
      experienceYears: 8,
      phone: '+91 98404 55634',
      onDuty: false
    }
  ],
  cardiac: [
    {
      id: 'DOC-CARD-01',
      name: 'Dr. S. Ramanathan',
      specialty: 'cardiac',
      subSpecialty: 'Chief Interventional Cardiologist',
      qualification: 'MBBS, MD, DM (Cardiology), FACC',
      room: 'Cath Lab 1 & Cardiac ER Bay',
      status: 'available',
      timeslots: ['08:30 AM - 12:30 PM', '03:00 PM - 06:30 PM', 'STEMI Fast-Track'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 18,
      phone: '+91 98405 66745',
      onDuty: true
    },
    {
      id: 'DOC-CARD-02',
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
    },
    {
      id: 'DOC-CARD-03',
      name: 'Dr. Arvind Natarajan',
      specialty: 'cardiac',
      subSpecialty: 'Cardiothoracic & Vascular Surgeon',
      qualification: 'MBBS, MS, M.Ch (CTVS)',
      room: 'Cardiac OT 2',
      status: 'on_call',
      timeslots: ['08:00 AM - 04:00 PM', 'Emergency CABG Standby'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 14,
      phone: '+91 98407 88967',
      onDuty: true
    }
  ],
  general: [
    {
      id: 'DOC-GEN-01',
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
      id: 'DOC-GEN-02',
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
    },
    {
      id: 'DOC-GEN-03',
      name: 'Dr. Dinesh Karthik',
      specialty: 'general',
      subSpecialty: 'Critical Care & Resuscitation Specialist',
      qualification: 'MBBS, DA, DNB (Critical Care)',
      room: 'ER Bay 3 / Triage Desk 2',
      status: 'available',
      timeslots: ['12:00 PM - 08:00 PM', 'Trauma Fast-Track'],
      shiftStart: '08:00',
      shiftEnd: '20:00',
      experienceYears: 8,
      phone: '+91 98410 21290',
      onDuty: true
    }
  ],
  obstetric: [
    {
      id: 'DOC-OBG-01',
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
      id: 'DOC-OBG-02',
      name: 'Dr. Kavita Venkat',
      specialty: 'obstetric',
      subSpecialty: 'Maternal-Fetal Medicine & High-Risk OBG',
      qualification: 'MBBS, MS (OBG), Fellowship in Fetal Medicine',
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

export class DoctorRosterService {
  /**
   * Retrieves enriched doctors on duty for a hospital, ensuring named doctors,
   * available timeslots, specialty badges, and room assignments.
   */
  public static getEnrichedDoctorsOnDuty(
    hospitalId: string,
    dbRows: Array<{ specialty: string; count: number; shift_start?: string; shift_end?: string }>
  ): { doctorsOnDuty: DoctorSpecialtyGroup[]; allDoctors: DoctorProfile[] } {
    const specialtiesInDb = new Set(dbRows.map((r) => r.specialty.toLowerCase()));
    const allSupportedSpecialties = ['neuro', 'cardiac', 'general', 'obstetric'];

    // Ensure neuro, cardiac, general are represented
    const targetSpecialties = Array.from(new Set([...specialtiesInDb, ...allSupportedSpecialties]));

    const enrichedGroups: DoctorSpecialtyGroup[] = [];
    const allDoctors: DoctorProfile[] = [];

    for (const spec of targetSpecialties) {
      const rosterList = MASTER_DOCTOR_ROSTER[spec] || [];
      const dbEntry = dbRows.find((r) => r.specialty.toLowerCase() === spec);
      const count = dbEntry ? Math.max(dbEntry.count, rosterList.filter((d) => d.onDuty).length) : rosterList.filter((d) => d.onDuty).length;

      const primaryDoc = rosterList[0] || {
        name: `Lead ${spec.toUpperCase()} Specialist`,
        qualification: 'MBBS, Specialist Board Certified',
        room: `${spec.toUpperCase()} Trauma OT`,
        status: 'available' as const,
        timeslots: ['08:00 AM - 02:00 PM', '02:00 PM - 08:00 PM']
      };

      // Hospital specific doctor customization
      const hospitalDocs = rosterList.map((doc, idx) => ({
        ...doc,
        id: `DOC-${hospitalId}-${spec.toUpperCase()}-${idx + 1}`
      }));

      hospitalDocs.forEach((d) => allDoctors.push(d));

      enrichedGroups.push({
        specialty: spec,
        count: count || 1,
        shift_start: dbEntry?.shift_start || '08:00',
        shift_end: dbEntry?.shift_end || '20:00',
        doctor_name: primaryDoc.name,
        qualification: primaryDoc.qualification,
        room: primaryDoc.room,
        status: primaryDoc.status,
        timeslots: primaryDoc.timeslots,
        doctors: hospitalDocs
      });
    }

    return { doctorsOnDuty: enrichedGroups, allDoctors };
  }

  /**
   * Allocates an on-duty doctor for an incoming emergency case based on hospital and clinical specialty
   */
  public static allocateDoctorForSpecialty(hospitalId: string, specialty?: string): DoctorProfile {
    const spec = (specialty || 'general').toLowerCase();
    const rosterList = MASTER_DOCTOR_ROSTER[spec] || MASTER_DOCTOR_ROSTER['general'] || [];
    const availableDoc = rosterList.find((d) => d.status === 'available' && d.onDuty) || rosterList[0];

    return {
      ...availableDoc,
      id: `DOC-${hospitalId}-${spec.toUpperCase()}-1`
    };
  }
}
