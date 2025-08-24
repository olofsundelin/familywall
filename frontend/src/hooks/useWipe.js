// src/hooks/useWipe.js
import { useRef, useCallback } from "react";

/**
 * Swipe/drag-hook för kalendern (horisontell).
 * - Vänster = framåt i tiden
 * - Höger = bakåt i tiden
 *
 * ignoreWithin: CSS-selektor(er) där vi INTE ska tolka swipe (t.ex. vertikala scroll-ytor).
 */
export default function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  // hur långt man måste svepa (px) för att trigga
  minDistance = 60,
  // tillåten ”off-axis” (hur mycket vertikal rörelse vi tolererar)
  maxOffAxis = 80,
  // ytor vi ska ignorera (matsedel och inköpslista)
  ignoreWithin = ".meal-plan-container, .shopping-list-container",
} = {}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const handled = useRef(false);
  const ignore = useRef(false);

  // --- Touch ---
  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    dragging.current = true;
    handled.current = false;
    // Om gesten startar i en scroll-yta → ignorera
    ignore.current = !!e.target.closest?.(ignoreWithin);
  }, [ignoreWithin]);

  const onTouchMove = useCallback((e) => {
    if (!dragging.current || handled.current || ignore.current) return;

    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    // Om det är mer vertikalt än vi tillåter → låt vertikal scroll ske
    if (Math.abs(dy) > maxOffAxis) return;

    if (Math.abs(dx) >= minDistance) {
      handled.current = true;
      // Vi tar gesten → stoppa bubbla/default så inget annat stör
      try { e.preventDefault(); } catch {}
      e.stopPropagation?.();

      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
  }, [maxOffAxis, minDistance, onSwipeLeft, onSwipeRight]);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    ignore.current = false;
  }, []);

  // --- Mus (desktop) ---
  const onMouseDown = useCallback((e) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    dragging.current = true;
    handled.current = false;
    ignore.current = !!e.target.closest?.(ignoreWithin);
  }, [ignoreWithin]);

  const onMouseMove = useCallback((e) => {
    if (!dragging.current || handled.current || ignore.current) return;

    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    if (Math.abs(dy) > maxOffAxis) return;

    if (Math.abs(dx) >= minDistance) {
      handled.current = true;
      e.preventDefault?.();
      e.stopPropagation?.();

      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
  }, [maxOffAxis, minDistance, onSwipeLeft, onSwipeRight]);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
    ignore.current = false;
  }, []);

  // --- Piltangenter för tillgänglighet ---
  const onKeyDown = useCallback((e) => {
    if (e.key === "ArrowLeft") {
      onSwipeRight?.(); // vänsterpil = gå bakåt
    } else if (e.key === "ArrowRight") {
      onSwipeLeft?.(); // högerpil = gå framåt
    }
  }, [onSwipeLeft, onSwipeRight]);

  return {
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onKeyDown,
      role: "region",
      tabIndex: 0, // så att sektionen kan få fokus för piltangenter
      "aria-label": "Kalender, svep eller använd piltangenter för att byta veckor",
    },
  };
}
