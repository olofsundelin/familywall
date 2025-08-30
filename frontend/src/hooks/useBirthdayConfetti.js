import { useEffect, useMemo, useRef } from "react";

function isTodayBirthday(events, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const sameDay = (dt) => dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;

  return events?.some((e) => {
    if (!e?.summary?.startsWith("🎂")) return false;
    const iso = e.start?.date || e.start?.dateTime;
    if (!iso) return false;
    const dt = new Date(iso);
    return sameDay(dt);
  });
}

async function fireOnce() {
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod?.default ?? mod;
    // HÖG zIndex så vi hamnar över overlays
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6, x: 0.2 }, zIndex: 2147483647 });
    setTimeout(() => confetti({ particleCount: 120, spread: 90, origin: { y: 0.6, x: 0.8 }, zIndex: 2147483647 }), 150);
    setTimeout(() => confetti({ particleCount: 180, spread: 100, origin: { y: 0.55, x: 0.5 }, zIndex: 2147483647 }), 320);
  } catch (e) {
    // swallow
  }
}

export default function useBirthdayConfetti({
  isMoving,
  events,
  cooldownMs = 30_000,   // 1 min default
  quietHours = [22, 6],  // sätt till null för att stänga av
  debug = false,
} = {}) {
  const manualOverride = localStorage.getItem("birthdayOverride") === "1";
  const birthdayToday = useMemo(() => manualOverride || isTodayBirthday(events), [events, manualOverride]);
  const prevMoving = useRef(false);
  const lastFiredRef = useRef(parseInt(localStorage.getItem("confetti-last-fired") || "0", 10));
  const timerRef = useRef(null);

  // Hjälpare
  const canFireNow = () => {
    const now = Date.now();
    if (quietHours) {
      const [start, end] = quietHours;
      const h = new Date().getHours();
      const inQuiet = start < end ? (h >= start && h < end) : (h >= start || h < end);
      if (inQuiet) return false;
    }
    return now - lastFiredRef.current >= cooldownMs;
  };
  const fire = async (reason) => {
    if (!canFireNow()) return;
    await fireOnce();
    lastFiredRef.current = Date.now();
    localStorage.setItem("confetti-last-fired", String(lastFiredRef.current));
    if (debug) console.log("[confetti] fired:", reason);
  };

  // 1) Skjut på rising edge (stilla -> rörelse)
  useEffect(() => {
    if (!birthdayToday) return;
    const justStartedMoving = isMoving && !prevMoving.current;
    prevMoving.current = isMoving;
    if (debug) console.log("[confetti] isMoving:", isMoving, "risingEdge:", justStartedMoving, "canFire:", canFireNow());
    if (justStartedMoving) fire("rising-edge");
  }, [isMoving, birthdayToday, cooldownMs, quietHours, debug]);

  // 2) Fallback-timer: om kameran redan är “sann” när vi laddar, trigga ändå när cooldown tillåter
  useEffect(() => {
    if (!birthdayToday) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (isMoving) fire("interval-fallback");
    }, 3000); // kolla var 3:e sekund
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [birthdayToday, isMoving, cooldownMs, quietHours, debug]);
}
