// useMidnightRefresh.js
import { useEffect, useRef } from "react";
import { triggerRefresh } from "../refreshBus";

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // lokal midnatt
  return next - now;
}

export default function useMidnightRefresh() {
  const last = useRef(new Date().toDateString());

  useEffect(() => {
    let timeoutId, fallbackId;

    const tick = () => {
      const today = new Date().toDateString();
      if (today !== last.current) {
        last.current = today;
        console.log("🌅 Ny dag – triggar refresh");
        triggerRefresh();
      }
      schedule();
    };

    const schedule = () => {
      clearTimeout(timeoutId);
      // +1s marginal för klock-drift
      timeoutId = setTimeout(tick, msUntilNextLocalMidnight() + 1000);
    };

    schedule();

    // Fallback om enheten sov vid midnatt
    fallbackId = setInterval(tick, 5 * 60 * 1000);

    // Om fliken/enheten väcks – kontrollera direkt
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(fallbackId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
}
