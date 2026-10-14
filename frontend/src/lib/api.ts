const API_BASE = '/api';

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error: {
    code: string;
    message: string;
    details?: any;
  } | null;
}

export function getAccessToken(): string | null {
  return localStorage.getItem('access_token');
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
}

export function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

async function fetchWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
  let token = getAccessToken();

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res = await fetch(url, { ...options, headers });

  // Token refresh logic on 401
  if (res.status === 401 && localStorage.getItem('refresh_token')) {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      const refreshJson = await refreshRes.json();
      if (refreshJson.ok && refreshJson.data?.tokens) {
        setTokens(refreshJson.data.tokens.accessToken, refreshJson.data.tokens.refreshToken);
        token = refreshJson.data.tokens.accessToken;
        headers.set('Authorization', `Bearer ${token}`);
        res = await fetch(url, { ...options, headers });
      } else {
        clearTokens();
        window.location.href = '/login';
      }
    } catch {
      clearTokens();
      window.location.href = '/login';
    }
  }

  const json: ApiResponse<T> = await res.json();
  if (!json.ok) {
    throw new Error(json.error?.message || 'API request failed');
  }

  return json.data;
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json: ApiResponse<{ user: any; tokens: { accessToken: string; refreshToken: string } }> = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Invalid login');
    setTokens(json.data.tokens.accessToken, json.data.tokens.refreshToken);
    return json.data;
  },

  getMe: async () => {
    return fetchWithAuth<{ user: any }>(`${API_BASE}/auth/me`);
  },

  logout: () => {
    clearTokens();
    window.location.href = '/login';
  },

  // Hospital Desk Endpoints
  getIncoming: async (hospitalId: string) => {
    return fetchWithAuth<{
      hospitalId: string;
      incomingPatients: any[];
      beds: Record<string, { total: number; available: number; updatedAt: string }>;
      doctorsOnDuty: any[];
    }>(`${API_BASE}/hospitals/${hospitalId}/incoming`);
  },

  updateBeds: async (hospitalId: string, bedType: 'ER' | 'ICU' | 'General', delta?: number, available?: number) => {
    return fetchWithAuth<any>(`${API_BASE}/hospitals/${hospitalId}/beds`, {
      method: 'PATCH',
      body: JSON.stringify({ bedType, delta, available })
    });
  },

  updateDoctors: async (hospitalId: string, specialty: string, count: number) => {
    return fetchWithAuth<any>(`${API_BASE}/hospitals/${hospitalId}/doctors`, {
      method: 'PATCH',
      body: JSON.stringify({ specialty, count })
    });
  },

  acceptPatient: async (hospitalId: string, reqId: string) => {
    return fetchWithAuth<any>(`${API_BASE}/hospitals/${hospitalId}/incoming/${reqId}/accept`, {
      method: 'POST'
    });
  },

  rejectPatient: async (hospitalId: string, reqId: string, reason: string) => {
    return fetchWithAuth<any>(`${API_BASE}/hospitals/${hospitalId}/incoming/${reqId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  markPatientArrived: async (hospitalId: string, reqId: string) => {
    return fetchWithAuth<any>(`${API_BASE}/hospitals/${hospitalId}/incoming/${reqId}/arrived`, {
      method: 'POST'
    });
  },

  getHistory: async (hospitalId: string) => {
    return fetchWithAuth<{ hospitalId: string; history: any[] }>(`${API_BASE}/hospitals/${hospitalId}/history`);
  },

  getAuditTrail: async (hospitalId: string) => {
    return fetchWithAuth<{ hospitalId: string; auditLogs: any[] }>(`${API_BASE}/hospitals/${hospitalId}/audit-trail`);
  },

  // Simulator
  simulateLoad: async (params: { count?: number; symptomsText?: string; targetHospitalId?: string }) => {
    return fetchWithAuth<any>(`${API_BASE}/simulate/load`, {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  simulateGps: async (params: { ambulanceId: string; requestId?: string; lat: number; lng: number; speed?: number }) => {
    return fetchWithAuth<any>(`${API_BASE}/simulate/ambulance-gps`, {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  simulateVitals: async (params: { requestId: string; ambulanceId?: string; hr: number; spo2: number; valid?: boolean }) => {
    return fetchWithAuth<any>(`${API_BASE}/simulate/vitals`, {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  simulateReset: async () => {
    return fetchWithAuth<any>(`${API_BASE}/simulate/reset`, {
      method: 'POST'
    });
  }
};
