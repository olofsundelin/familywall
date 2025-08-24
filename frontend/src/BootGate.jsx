import React, { useEffect, useMemo, useState, useCallback } from "react";

/** Fetch med timeout */
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 6000, ...rest } = opts;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/** Exponentiell backoff i ms: 1s, 2s, 4s, 8s, 10s (cap) */
const backoff = (attempt) => Math.min(1000 * 2 ** attempt, 10000);

/**
 * BootGate
 * - Visar splash (favicon + text) tills backend svarar.
 * - Kollar /api/health (om finns) eller faller tillbaka på /api/events.
 * - Miljö-agnostisk utan import.meta: tar prop apiBase, annars CRA env eller same-origin.
 */
export default function BootGate({ children, apiBase }) {
  const [status, setStatus] = useState("boot"); // boot | ok | error
  const [message, setMessage] = useState("Laddar tjänster…");
  const [attempt, setAttempt] = useState(0);
  const [lastError, setLastError] = useState(null);

  // Bygg lista av kontroll-URL:er (utan import.meta)
  const checks = useMemo(() => {
    const backendRaw =
      apiBase ??
      process.env.REACT_APP_API_BASE_URL ??
      window.location.origin;

    const backend = String(backendRaw || "").replace(/\/+$/, "");
    const healthPath = process.env.REACT_APP_HEALTH_PATH || "/api/health";
    const gcal = process.env.REACT_APP_GCAL_HEALTH; // valfri extern health

    const urls = [`${backend}${healthPath}`];
    if (gcal) urls.push(gcal);

    return { backend, urls };
  }, [apiBase]);

  const runChecks = useCallback(async () => {
    setStatus("boot");
    setMessage("Laddar tjänster…");
    setLastError(null);

    try {
      // Kör alla checks parallellt; kräv 2xx och ev. {status:"ok"}
      const results = await Promise.all(
        checks.urls.map(async (url) => {
          const res = await fetchWithTimeout(url, { timeout: 6000 });
          if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const data = await res.json().catch(() => ({}));
            if (data.status && data.status !== "ok") {
              throw new Error(`${url} -> status=${data.status}`);
            }
          }
          return true;
        })
      );

      if (results.every(Boolean)) {
        setStatus("ok");
        setMessage("Klart!");
        return;
      }
      throw new Error("Minst en tjänst svarade inte OK.");
    } catch (err) {
      // Fallback: prova /api/events innan vi ger upp
      setLastError(err?.message || String(err));
      try {
        const url = `${checks.backend}/api/events`;
        const res = await fetchWithTimeout(url, { timeout: 6000 });
        if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
        setStatus("ok");
        setMessage("Klart!");
        return;
      } catch (fallbackErr) {
        setLastError(
          (err?.message || String(err)) + " | Fallback: " + (fallbackErr?.message || String(fallbackErr))
        );
        setStatus("error");
      }
    }
  }, [checks]);

  // Auto-retry med backoff när status är error
  useEffect(() => {
    if (status !== "error") return;

    const delay = backoff(attempt);
    setMessage(`Tjänster nere… försöker igen om ${Math.round(delay / 1000)} s`);
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      runChecks();
    }, delay);

    return () => clearTimeout(t);
  }, [status, attempt, runChecks]);

  // Första körningen
  useEffect(() => {
    setAttempt(0);
    runChecks();
  }, [runChecks]);

  if (status === "ok") return children;

  // Splash-overlay
  return (
    <div className="splash-overlay" role="status" aria-live="polite">
      <div className="splash-card">
        <img
          src="/favicon.png"
          alt="Family Wall"
          className="splash-logo"
          draggable={false}
        />
        <div className="splash-text">{message}</div>

        {status === "error" && (
          <button
            className="splash-retry"
            onClick={() => {
              setAttempt(0);
              runChecks();
            }}
          >
            Försök igen nu
          </button>
        )}

        {/* Liten teknisk rad för admin – håll musen över för detaljer */}
        <div
          className="splash-hint"
          title={lastError ? `Teknisk info: ${lastError}` : ""}
        >
          {status === "boot"
            ? "Initierar tjänster…"
            : "Tjänst otillgänglig – väntar på backend"}
        </div>
      </div>
    </div>
  );
}
