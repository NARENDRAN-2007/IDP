import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ambulance,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cross,
  HeartPulse,
  Hospital,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Siren,
  Timer,
  TriangleAlert,
  UserRound,
  Zap,
} from "lucide-react";

// STEP 1 — CONFIG
const API_BASE_URL = "http://localhost:8000/api";

type LocationSource = "gps" | "approximate";

const STATUS_FORMAT_MAP: Record<string, string> = {
  CREATED: "Created",
  LOCATION_CAPTURED: "Location Captured",
  AMBULANCE_ALLOCATED: "Ambulance Allocated",
  PROVISIONAL_HOSPITAL_MATCHED: "Hospital Matched",
  SYMPTOMS_RECEIVED: "Symptoms Received",
  SEVERITY_CLASSIFIED: "Severity Classified",
  HOSPITAL_REMATCHED: "Hospital Rematched",
  BED_HELD: "Bed Held",
  BED_CONFIRMED: "Bed Confirmed",
  BED_HOLD_TIMED_OUT: "Hold Timed Out",
  NO_HOSPITAL_AVAILABLE: "No Hospital Available",
  NO_AMBULANCE_AVAILABLE: "No Ambulance Available",
};

function formatStatus(status: string | null | undefined): string {
  if (!status) return "";
  if (STATUS_FORMAT_MAP[status]) return STATUS_FORMAT_MAP[status];
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(at: number | Date, now: number): string {
  const timestamp = typeof at === "number" ? at : at.getTime();
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function severityMeta(level: number | null) {
  if (!level) return { label: "Unknown", className: "severity-moderate" };
  const meta: Record<number, { label: string; className: string }> = {
    1: { label: "Critical", className: "severity-critical" },
    2: { label: "Serious", className: "severity-serious" },
    3: { label: "Moderate", className: "severity-moderate" },
    4: { label: "Minor", className: "severity-minor" },
  };
  return meta[level] ?? { label: "Moderate", className: "severity-moderate" };
}

function statusTone(status: string): "red" | "amber" | "green" | "blue" {
  switch (status) {
    case "BED_CONFIRMED":
      return "green";
    case "BED_HELD":
    case "HOSPITAL_REMATCHED":
    case "PROVISIONAL_HOSPITAL_MATCHED":
      return "amber";
    case "BED_HOLD_TIMED_OUT":
    case "NO_HOSPITAL_AVAILABLE":
    case "NO_AMBULANCE_AVAILABLE":
      return "red";
    case "CREATED":
    case "LOCATION_CAPTURED":
    case "AMBULANCE_ALLOCATED":
    case "SYMPTOMS_RECEIVED":
    case "SEVERITY_CLASSIFIED":
    default:
      return "blue";
  }
}

function getStatusDetail(
  statusName: string,
  context: {
    latitude: string;
    longitude: string;
    locationSource: string;
    ambulance: any;
    currentHospital: any;
    requiredSpecialty: string | null;
    severityLevel: number | null;
    activeHoldId: string | null;
    rankedHospitals: any[];
  }
): string {
  switch (statusName) {
    case "CREATED":
      return "Emergency request created in dispatch engine";
    case "LOCATION_CAPTURED":
      return `Location locked · ${context.latitude}, ${context.longitude} (${context.locationSource.toUpperCase()})`;
    case "AMBULANCE_ALLOCATED":
      return context.ambulance
        ? `${context.ambulance.id} · ${context.ambulance.status || "Assigned"}`
        : "Ambulance allocated";
    case "PROVISIONAL_HOSPITAL_MATCHED":
      return context.currentHospital
        ? `${context.currentHospital.name} · provisional match`
        : "Provisional hospital located";
    case "SYMPTOMS_RECEIVED":
      return "Patient symptoms recorded";
    case "SEVERITY_CLASSIFIED":
      return context.severityLevel
        ? `Triage level ${context.severityLevel} assigned`
        : "Severity classified";
    case "HOSPITAL_REMATCHED":
      return context.rankedHospitals.length > 0
        ? `${context.rankedHospitals.length} hospitals ranked for specialty`
        : "Hospital ranked";
    case "BED_HELD":
      return context.currentHospital
        ? `Provisional bed hold at ${context.currentHospital.name}`
        : "Bed held";
    case "BED_CONFIRMED":
      return context.currentHospital
        ? `${context.currentHospital.name} · bed hold converted to confirmed`
        : "Hospital bed reservation confirmed";
    case "BED_HOLD_TIMED_OUT":
      return "Hold expired, cascading to next ranked hospital";
    case "NO_HOSPITAL_AVAILABLE":
      return "No hospital found with matching bed availability";
    case "NO_AMBULANCE_AVAILABLE":
      return "No free ambulances available in radius";
    default:
      return "Status updated";
  }
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`surface-card ${className}`}>{children}</section>;
}

function SectionHeader({
  eyebrow,
  title,
  icon,
  action,
}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-heading">
        <div className="section-icon">{icon}</div>
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
        </div>
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  // STEP 2 — GLOBAL STATE TO TRACK
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [ambulance, setAmbulance] = useState<{ id: string; lat: number; lng: number; status: string } | null>(null);
  const [provisionalHospitalId, setProvisionalHospitalId] = useState<string | null>(null);
  const [confirmedHospitalId, setConfirmedHospitalId] = useState<string | null>(null);
  const [activeHoldId, setActiveHoldId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [severityLevel, setSeverityLevel] = useState<number | null>(null);
  const [requiredSpecialty, setRequiredSpecialty] = useState<string | null>(null);
  const [bedType, setBedType] = useState<"ER" | "ICU" | null>(null);
  const [rankedHospitals, setRankedHospitals] = useState<any[]>([]);
  const [statusLog, setStatusLog] = useState<{ status: string; at: number }[]>([]);
  const [cascadeCount, setCascadeCount] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Form & UI state
  const [latitude, setLatitude] = useState("13.0827");
  const [longitude, setLongitude] = useState("80.2707");
  const [locationSource, setLocationSource] = useState<LocationSource>("gps");
  const [symptoms, setSymptoms] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [error, setError] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [hospitalsMap, setHospitalsMap] = useState<Record<string, any>>({});
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number | null; durationMin: number | null } | null>(null);
  const [isSubmittingTrigger, setIsSubmittingTrigger] = useState(false);
  const [isSubmittingSymptoms, setIsSubmittingSymptoms] = useState(false);
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState(false);

  const active = Boolean(requestId);
  const confirmed = Boolean(confirmedHospitalId || status === "BED_CONFIRMED");
  const isSymptomsSubmitted = Boolean(severityLevel !== null || rankedHospitals.length > 0);
  const severityInfo = severityMeta(severityLevel);
  const currentTime = clock.getTime();

  // Load initial hospitals list into cache for seamless ID-to-metadata resolution
  useEffect(() => {
    fetch(`${API_BASE_URL}/hospitals`)
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data)) {
          const map: Record<string, any> = {};
          json.data.forEach((h: any) => {
            map[h.id] = h;
          });
          setHospitalsMap((prev) => ({ ...map, ...prev }));
        }
      })
      .catch((err) => {
        console.warn("Initial hospitals seed load warning:", err);
      });
  }, []);

  // Clock tick
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  // STEP 7 — COUNTDOWN TIMER LOGIC
  useEffect(() => {
    if (!holdExpiresAt || confirmed) {
      setSecondsLeft(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, holdExpiresAt - Date.now());
      setSecondsLeft(Math.ceil(remaining / 1000));
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [holdExpiresAt, confirmed]);

  // STEP 6 — STATUS POLLING (background, continuous)
  useEffect(() => {
    if (!isPolling || !requestId) return;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/emergency/${requestId}/status`);
        const json = await res.json();
        if (!json.ok) {
          console.error("Status poll error:", json.error);
          return;
        }

        const data = json.data;
        if (!data) return;

        setStatus(data.status);
        setProvisionalHospitalId(data.provisionalHospitalId);
        setConfirmedHospitalId(data.confirmedHospitalId);
        setStatusLog(data.statusLog || []);
        setCascadeCount(data.cascadeCount || 0);

        if (data.candidateHospitals && Array.isArray(data.candidateHospitals) && data.candidateHospitals.length > 0) {
          setRankedHospitals(data.candidateHospitals);
          setHospitalsMap((prev) => {
            const next = { ...prev };
            data.candidateHospitals.forEach((h: any) => {
              next[h.id] = h;
            });
            return next;
          });
        }

        // Compare NEW activeHoldId to PREVIOUS activeHoldId in state
        setActiveHoldId((prevHoldId) => {
          const newHoldId = data.activeHoldId;
          if (newHoldId && newHoldId !== prevHoldId) {
            // Restart countdown: newest BED_HELD in statusLog + 30000ms
            const bedHeldLogs = (data.statusLog || []).filter((l: any) => l.status === "BED_HELD");
            const latestBedHeld = bedHeldLogs[bedHeldLogs.length - 1];
            const newExpiresAt = latestBedHeld ? latestBedHeld.at + 30000 : Date.now() + 30000;
            setHoldExpiresAt(newExpiresAt);
          }
          return newHoldId;
        });

        // TERMINAL STATUSES
        if (
          data.status === "BED_CONFIRMED" ||
          data.status === "NO_HOSPITAL_AVAILABLE" ||
          data.status === "NO_AMBULANCE_AVAILABLE"
        ) {
          setIsPolling(false);
        }
      } catch (err) {
        console.warn("Status poll connection issue, will retry in 2s:", err);
        setNetworkError("Connection lost — retrying...");
      }
    };

    const intervalId = window.setInterval(poll, 2000);
    return () => window.clearInterval(intervalId);
  }, [isPolling, requestId]);

  // Derived current active hospital
  const currentHospitalId = confirmedHospitalId || provisionalHospitalId;
  const currentHospital = useMemo(() => {
    if (!currentHospitalId) return null;
    return (
      rankedHospitals.find((h) => h.id === currentHospitalId) ||
      hospitalsMap[currentHospitalId] ||
      null
    );
  }, [currentHospitalId, rankedHospitals, hospitalsMap]);

  // Countdown display tone and labels
  const countdownTone =
    secondsLeft <= 0
      ? "expired"
      : secondsLeft < 10
      ? "urgent"
      : secondsLeft <= 20
      ? "warning"
      : "safe";

  const countdownLabel =
    secondsLeft <= 0
      ? "Hold expired — reassigning to next hospital..."
      : secondsLeft < 10
      ? `${secondsLeft}s left! Confirm now`
      : `${secondsLeft}s remaining`;

  const latestStatus = status || statusLog.at(-1)?.status || "CREATED";

  // STEP 3 — TRIGGER EMERGENCY
  async function handleTrigger() {
    setError("");
    setNetworkError("");
    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setError("Enter a valid latitude and longitude to locate the emergency.");
      return;
    }

    setIsSubmittingTrigger(true);
    try {
      const res = await fetch(`${API_BASE_URL}/emergency/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: latNum,
          lng: lngNum,
          locationSource,
        }),
      });
      const json = await res.json();

      if (json.ok === false) {
        if (json.error === "NO_AMBULANCE_AVAILABLE") {
          setError("No ambulances available right now. Please try again shortly.");
        } else {
          setError("No hospital found near this location.");
        }
        setIsSubmittingTrigger(false);
        return;
      }

      if (json.ok === true) {
        if (!json.data || json.data.provisionalHospital === null) {
          setError("No hospital found near this location.");
          setIsSubmittingTrigger(false);
          return;
        }

        const data = json.data;
        setRequestId(data.requestId);
        setAmbulance(data.ambulance);
        setProvisionalHospitalId(data.provisionalHospital.id);
        setStatus("LOCATION_CAPTURED");
        setCascadeCount(0);

        if (data.provisionalHospital) {
          setHospitalsMap((prev) => ({
            ...prev,
            [data.provisionalHospital.id]: data.provisionalHospital,
          }));
        }

        if (data.holdId) {
          setActiveHoldId(data.holdId);
          setHoldExpiresAt(data.holdExpiresAt);
        }

        // Store route info from ORS (may be nulls if ORS failed)
        if (data.routeInfo) {
          setRouteInfo(data.routeInfo);
        } else {
          setRouteInfo({ distanceKm: null, durationMin: null });
        }

        // Start polling immediately
        setIsPolling(true);
      }
    } catch (err) {
      setNetworkError("Connection lost — retrying...");
      setError("Unable to connect to the server. Please check your connection and retry.");
    } finally {
      setIsSubmittingTrigger(false);
    }
  }

  // STEP 4 — SUBMIT SYMPTOMS
  async function handleSubmitSymptoms() {
    if (!symptoms.trim()) {
      setError("Add a short symptom description before submitting.");
      return;
    }
    if (!requestId) return;

    setError("");
    setNetworkError("");
    setIsSubmittingSymptoms(true);

    try {
      const res = await fetch(`${API_BASE_URL}/emergency/${requestId}/symptoms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptomsText: symptoms.trim() }),
      });
      const json = await res.json();

      if (json.ok === true) {
        const data = json.data;
        if (!data || !data.rematchedHospitalRanked || data.rematchedHospitalRanked.length === 0) {
          setError("No hospital available for this severity and location.");
          setIsSubmittingSymptoms(false);
          return;
        }

        setSeverityLevel(data.severityLevel);
        setRequiredSpecialty(data.requiredSpecialty);
        // Derive bedType: severityLevel === 1 -> "ICU" : "ER"
        const derivedBedType = data.severityLevel === 1 ? "ICU" : "ER";
        setBedType(derivedBedType);
        setRankedHospitals(data.rematchedHospitalRanked);

        if (data.rematchedHospitalRanked.length > 0) {
          setProvisionalHospitalId(data.rematchedHospitalRanked[0].id);
        }

        if (data.holdId) {
          setActiveHoldId(data.holdId);
          setHoldExpiresAt(data.holdExpiresAt);
        }

        setHospitalsMap((prev) => {
          const next = { ...prev };
          data.rematchedHospitalRanked.forEach((h: any) => {
            next[h.id] = h;
          });
          return next;
        });
      } else {
        setError(json.error || "Failed to process symptoms.");
      }
    } catch (err) {
      setNetworkError("Connection lost — retrying...");
      setError("Unable to connect to the server. Please check your connection and retry.");
    } finally {
      setIsSubmittingSymptoms(false);
    }
  }

  // STEP 5 — CONFIRM HOSPITAL
  async function handleConfirm() {
    if (!requestId) return;

    setError("");
    setNetworkError("");
    setIsSubmittingConfirm(true);

    try {
      const res = await fetch(`${API_BASE_URL}/emergency/${requestId}/confirm-hospital`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();

      if (json.ok === false) {
        if (json.error === "NO_ACTIVE_HOLD") {
          setError("No active hold yet — submit symptoms first.");
        } else if (json.error === "HOLD_EXPIRED_OR_INVALID") {
          setError("This hold expired — the system is reassigning to the next hospital.");
        } else {
          setError(json.error || "Failed to confirm hospital.");
        }
        setIsSubmittingConfirm(false);
        return;
      }

      if (json.ok === true) {
        setConfirmedHospitalId(json.data.confirmedHospitalId);
        setStatus(json.data.status || "BED_CONFIRMED");
        setHoldExpiresAt(null);
        setSecondsLeft(0);
        setIsPolling(false);
      }
    } catch (err) {
      setNetworkError("Connection lost — retrying...");
      setError("Unable to connect to the server. Please check your connection and retry.");
    } finally {
      setIsSubmittingConfirm(false);
    }
  }

  // STEP 9 — RESET DEMO
  async function resetDemo() {
    if (!window.confirm("Reset demo? This clears the current request.")) return;
    setError("");
    setNetworkError("");
    try {
      const res = await fetch(`${API_BASE_URL}/simulate/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.ok === true) {
        setRequestId(null);
        setStatus(null);
        setAmbulance(null);
        setProvisionalHospitalId(null);
        setConfirmedHospitalId(null);
        setActiveHoldId(null);
        setHoldExpiresAt(null);
        setSeverityLevel(null);
        setRequiredSpecialty(null);
        setBedType(null);
        setRankedHospitals([]);
        setStatusLog([]);
        setCascadeCount(0);
        setIsPolling(false);
        setSymptoms("");
        setSecondsLeft(0);
        setDetailsOpen(false);
        setRouteInfo(null);
      }
    } catch (err) {
      setNetworkError("Connection lost — retrying...");
      setError("Unable to connect to the server to reset state.");
    }
  }

  const confirmedHospitalName = currentHospital?.name || "Hospital";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Cross size={19} strokeWidth={2.7} />
            </div>
            <div>
              <div className="brand-name">
                Response<span>Grid</span>
              </div>
              <div className="brand-subtitle">Emergency coordination console</div>
            </div>
          </div>
          <div className="header-status">
            {isPolling && (
              <span className="live-indicator" title="Live — updating every 2 seconds">
                <span className="pulse-dot" /> Live monitoring
              </span>
            )}
            <span className="clock">
              <Clock3 size={14} />{" "}
              {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <button className="reset-button" onClick={resetDemo}>
              <RotateCcw size={14} /> Reset Demo
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-wrap">
        <div className="page-intro">
          <div>
            <div className="breadcrumb">
              <span>Operations</span>
              <ArrowRight size={12} />
              <strong>Emergency response</strong>
            </div>
            <h1>Emergency Response Dashboard</h1>
            <p>Coordinate an ambulance, secure a provisional bed, and confirm the right hospital before the hold expires.</p>
          </div>
          <div className="api-chip">
            <span className="api-dot" /> API Connected ({API_BASE_URL})
          </div>
        </div>

        {networkError && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={17} />
            <span>{networkError}</span>
            <button onClick={() => setNetworkError("")}>Dismiss</button>
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={17} />
            <span>{error}</span>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}

        {!active ? (
          <Card className="trigger-card">
            <SectionHeader
              eyebrow="Step 01 · Locate"
              title="Trigger an emergency"
              icon={<Siren size={20} />}
              action={<span className="step-pill">Ready</span>}
            />
            <div className="trigger-grid">
              <label className="field">
                <span>Latitude</span>
                <div className="input-wrap">
                  <LocateFixed size={16} />
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                    placeholder="13.0827"
                  />
                </div>
              </label>
              <label className="field">
                <span>Longitude</span>
                <div className="input-wrap">
                  <MapPin size={16} />
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                    placeholder="80.2707"
                  />
                </div>
              </label>
              <div className="field">
                <span>Location source</span>
                <div className="segmented-control">
                  <button
                    className={locationSource === "gps" ? "selected" : ""}
                    onClick={() => setLocationSource("gps")}
                  >
                    <Navigation size={14} /> GPS
                  </button>
                  <button
                    className={locationSource === "approximate" ? "selected" : ""}
                    onClick={() => setLocationSource("approximate")}
                  >
                    <MapPin size={14} /> Approximate
                  </button>
                </div>
              </div>
            </div>
            <div className="trigger-footer">
              <span className="helper-text">
                <ShieldCheck size={15} /> Secure location handoff ·{" "}
                {locationSource === "gps" ? "GPS coordinates" : "Approximate location"}
              </span>
              <button
                className="primary-button"
                onClick={handleTrigger}
                disabled={isSubmittingTrigger}
              >
                {isSubmittingTrigger ? "Locating..." : "Trigger Emergency"} <ArrowRight size={16} />
              </button>
            </div>
          </Card>
        ) : (
          <div className="collapsed-strip">
            <div className="collapsed-left">
              <span className="success-mark">
                <Check size={14} />
              </span>
              <span>
                <strong>Request {requestId}</strong> triggered successfully
              </span>
              <span className="strip-separator" />
              <span className="muted">
                Location locked · {latitude}, {longitude}
              </span>
            </div>
            <button onClick={resetDemo} className="text-button">
              Start New Emergency <ArrowRight size={14} />
            </button>
          </div>
        )}

        {!active ? (
          <div className="empty-state">
            <div className="empty-orbit">
              <HeartPulse size={27} />
            </div>
            <h2>No active emergency</h2>
            <p>Trigger one above to begin. Live ambulance and hospital coordination will appear here.</p>
          </div>
        ) : (
          <>
            <div className="two-column-grid">
              <Card className="resource-card">
                <div className="resource-topline">
                  <div className="resource-label">
                    <Ambulance size={17} />
                    <span>Ambulance</span>
                  </div>
                  <span className="status-badge status-assigned">
                    <span /> {ambulance?.status ? ambulance.status.toUpperCase() : "ASSIGNED"}
                  </span>
                </div>
                <div className="resource-main">
                  <div>
                    <div className="resource-title">{ambulance?.id || "—"}</div>
                  </div>
                  <div className="resource-avatar ambulance-avatar">
                    <Ambulance size={22} />
                  </div>
                </div>
                <div className="resource-meta">
                  <span>
                    <MapPin size={14} />{" "}
                    {ambulance ? `${ambulance.lat}, ${ambulance.lng}` : "—"}
                  </span>
                  <span>
                    <Radio size={14} /> En route
                  </span>
                </div>
                <div className="resource-progress">
                  <span style={{ width: "68%" }} />
                </div>
                <div className="progress-label">
                  <span>Arriving at scene</span>
                  <strong>68%</strong>
                </div>
              </Card>

              <Card className="resource-card hospital-resource">
                <div className="resource-topline">
                  <div className="resource-label">
                    <Hospital size={17} />
                    <span>{confirmed ? "Confirmed hospital" : "Provisional hospital"}</span>
                  </div>
                  <span className="provisional-tag">
                    {confirmed ? "Confirmed" : "Provisional"}
                  </span>
                </div>
                <div className="resource-main">
                  <div>
                    <div className="resource-title hospital-name">
                      {currentHospital?.name || "Locating..."}
                    </div>
                    <div className="resource-subtitle">
                      {routeInfo && routeInfo.distanceKm !== null && routeInfo.durationMin !== null
                        ? `${routeInfo.distanceKm} km away · ${routeInfo.durationMin} min drive`
                        : "Distance unavailable"}
                    </div>
                  </div>
                  <div className="resource-avatar hospital-avatar">
                    <Hospital size={22} />
                  </div>
                </div>
                <div className="resource-meta">
                  <span>
                    <BadgeCheck size={14} />{" "}
                    {currentHospital?.empanelled ? "Empanelled" : "Non-empanelled"}
                  </span>
                  {requiredSpecialty && (
                    <span>
                      <HeartPulse size={14} /> {requiredSpecialty}
                    </span>
                  )}
                </div>
                {requiredSpecialty && (
                  <div className="hospital-note">
                    <Zap size={14} /> Best ranked match for current severity
                  </div>
                )}
              </Card>
            </div>

            <div className={`hold-banner ${confirmed ? "safe" : countdownTone}`}>
              <div className="hold-icon">
                <Timer size={20} />
              </div>
              <div className="hold-copy">
                <div className="hold-kicker">BED HOLD · {requestId}</div>
                <div className="hold-message">
                  {confirmed ? "Bed hold secured — transfer can proceed" : countdownLabel}{" "}
                  {!confirmed && currentHospital && (
                    <span>
                      — Bed hold at <strong>{currentHospital.name}</strong>
                    </span>
                  )}
                </div>
              </div>
              <div className="countdown-number">
                {confirmed ? "OK" : secondsLeft}
                <small>{confirmed ? "" : "sec"}</small>
              </div>
            </div>

            {confirmed ? (
              <div className="confirmed-banner">
                <CheckCircle2 size={21} />
                <div>
                  <strong>Bed Confirmed at {confirmedHospitalName}</strong>
                  <span>Ambulance team and hospital have been notified.</span>
                </div>
                <span className="confirmed-time">
                  {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ) : (
              <button
                className="confirm-button"
                onClick={handleConfirm}
                disabled={isSubmittingConfirm}
              >
                <ShieldCheck size={18} /> Confirm Hospital{" "}
                <span>Secure this bed for the patient</span>
                <ArrowRight size={17} />
              </button>
            )}

            <div className="workflow-grid">
              <div className="workflow-left">
                {!isSymptomsSubmitted ? (
                  <Card className="symptom-card">
                    <SectionHeader
                      eyebrow="Step 02 · Triage"
                      title="Enter symptoms"
                      icon={<HeartPulse size={20} />}
                      action={<span className="step-count">2 / 4</span>}
                    />
                    <p className="section-description">
                      Share the patient’s current symptoms so we can rank the most appropriate receiving hospital.
                    </p>
                    <textarea
                      value={symptoms}
                      onChange={(event) => setSymptoms(event.target.value)}
                      placeholder="e.g. severe chest pain and unconscious"
                      rows={4}
                    />
                    <div className="symptom-footer">
                      <span className="helper-text">
                        <ShieldCheck size={15} /> Clinical data stays within this request
                      </span>
                      <button
                        className="secondary-button"
                        onClick={handleSubmitSymptoms}
                        disabled={isSubmittingSymptoms}
                      >
                        <Send size={15} /> {isSubmittingSymptoms ? "Submitting..." : "Submit Symptoms"}
                      </button>
                    </div>
                  </Card>
                ) : (
                  <Card className="severity-card">
                    <SectionHeader
                      eyebrow="Step 03 · Match"
                      title="Severity & ranked hospitals"
                      icon={<Activity size={20} />}
                      action={
                        severityLevel ? (
                          <span className={`severity-badge ${severityInfo.className}`}>
                            <span /> Level {severityLevel} · {severityInfo.label}
                          </span>
                        ) : undefined
                      }
                    />
                    <div className="severity-summary">
                      <div className={`severity-number ${severityInfo.className}`}>
                        {severityLevel || "—"}
                      </div>
                      <div>
                        <strong>Bed type</strong>
                        <span>{bedType || "—"}</span>
                      </div>
                      <div>
                        <strong>Specialty</strong>
                        <span>{requiredSpecialty || "—"}</span>
                      </div>
                      <div className="summary-rule" />
                      <div>
                        <strong>Matches found</strong>
                        <span>{rankedHospitals.length} hospitals in radius</span>
                      </div>
                    </div>
                    <div className="ranked-list">
                      {rankedHospitals.map((item, index) => {
                        const isCurrent =
                          item.id === (confirmedHospitalId || provisionalHospitalId) ||
                          (index === 0 && !confirmedHospitalId && !provisionalHospitalId);
                        const isSpecialtyMatch = Boolean(
                          requiredSpecialty &&
                            item.specialties &&
                            item.specialties.some(
                              (s: string) => s.toLowerCase() === requiredSpecialty.toLowerCase()
                            )
                        );
                        return (
                          <div
                            key={item.id || item.name || index}
                            className={`ranked-row ${isCurrent ? "current" : ""}`}
                          >
                            <span className="rank-number">0{index + 1}</span>
                            <span className="rank-hospital">
                              <strong>{item.name}</strong>
                              <small>
                                {index === 0 && routeInfo && routeInfo.distanceKm !== null && routeInfo.durationMin !== null
                                  ? `${routeInfo.distanceKm} km · ${routeInfo.durationMin} min drive`
                                  : index === 0
                                    ? "Distance unavailable"
                                    : "Straight-line estimate"}
                              </small>
                            </span>
                            <span className="rank-tags">
                              {item.empanelled && (
                                <span className="tiny-tag blue">
                                  <BadgeCheck size={12} /> Empanelled
                                </span>
                              )}
                              {isSpecialtyMatch && (
                                <span className="tiny-tag green">
                                  <Check size={12} /> Specialty match
                                </span>
                              )}
                            </span>
                            {isCurrent && <span className="current-pick">Current pick</span>}
                            <ArrowRight size={15} className="row-arrow" />
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </div>

              <aside className="brief-panel">
                <div className="brief-header">
                  <div className="brief-icon">
                    <UserRound size={17} />
                  </div>
                  <div>
                    <div className="eyebrow">Patient brief</div>
                    <strong>Live request context</strong>
                  </div>
                </div>
                <div className="brief-row">
                  <span>Request ID</span>
                  <strong>{requestId || "—"}</strong>
                </div>
                <div className="brief-row">
                  <span>Latest status</span>
                  <strong className="brief-status">
                    <span /> {formatStatus(latestStatus)}
                  </strong>
                </div>
                <div className="brief-row">
                  <span>Location source</span>
                  <strong>{locationSource === "gps" ? "GPS verified" : "Approximate"}</strong>
                </div>
                <div className="brief-row">
                  <span>Last update</span>
                  <strong>
                    {timeAgo(statusLog.at(-1)?.at ?? Date.now(), currentTime)}
                  </strong>
                </div>
              </aside>
            </div>

            <Card className="timeline-card">
              <button className="timeline-toggle" onClick={() => setDetailsOpen(!detailsOpen)}>
                <div className="timeline-title">
                  <div className="section-icon">
                    <Activity size={18} />
                  </div>
                  <div>
                    <div className="eyebrow">Audit trail</div>
                    <h2>Status timeline</h2>
                  </div>
                </div>
                <span className="toggle-label">
                  {detailsOpen ? "Hide Details" : "Show Details"}
                  <ChevronDown size={16} className={detailsOpen ? "rotated" : ""} />
                </span>
              </button>
              {cascadeCount > 0 && (
                <div className="cascade-warning">
                  <TriangleAlert size={15} /> Reassigned {cascadeCount} time{cascadeCount === 1 ? "" : "s"} due to timeout
                </div>
              )}
              {detailsOpen && (
                <div className="timeline-list">
                  {[...statusLog].reverse().map((entry, index) => {
                    const tone = statusTone(entry.status);
                    return (
                      <div className="timeline-entry" key={`${entry.status}-${entry.at}-${index}`}>
                        <div className={`timeline-dot ${tone}`}>
                          {index === 0 ? <span /> : <Check size={11} />}
                        </div>
                        <div className="timeline-entry-copy">
                          <strong>{formatStatus(entry.status)}</strong>
                          <span>
                            {getStatusDetail(entry.status, {
                              latitude,
                              longitude,
                              locationSource,
                              ambulance,
                              currentHospital,
                              requiredSpecialty,
                              severityLevel,
                              activeHoldId,
                              rankedHospitals,
                            })}
                          </span>
                        </div>
                        <time>{timeAgo(entry.at, currentTime)}</time>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}

        <footer className="page-footer">
          <span>
            <ShieldCheck size={14} /> Protected operations workspace
          </span>
          <span>All times local · Chennai, IN</span>
          <span>
            API poll interval <strong>2s</strong>
          </span>
        </footer>
      </main>
    </div>
  );
}
