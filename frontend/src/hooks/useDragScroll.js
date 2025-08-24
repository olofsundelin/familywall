// src/hooks/useDragScroll.js
import { useEffect, useRef } from "react";

/**
 * Drag-to-scroll för valfri container.
 * - Emulerar drag-scroll ENDAST för mus (desktop, pointer=fine).
 * - På touch/pen lämnar vi scroll till webbläsaren (native).
 * - axis: 'y' | 'x' | 'both'
 * - momentum gäller bara desktop-draget (mus).
 */
export default function useDragScroll({
  axis = "y",
  momentum = true,
  disabled = false,
  activateThreshold = 4, // px innan vi "tar" drag – skyddar klick/länkar
} = {}) {
  const ref = useRef(null);
  const state = useRef({
    active: false,
    isMouse: false,
    dragging: false, // blir true först efter threshold
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    lastX: 0,
    lastY: 0,
    vx: 0,
    vy: 0,
    raf: 0,
  });

  const isInteractive = (el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return false;
    return (
      ["input", "textarea", "select", "button", "label"].includes(tag) ||
      el.closest?.("a,button,input,textarea,select,label,[role='button']")
    );
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    // Låt touch scrolla native, och tala om avsikten:
    el.style.touchAction =
      axis === "y" ? "pan-y" : axis === "x" ? "pan-x" : "auto";

    // Sätt "grab" bara på desktop (pointer=fine)
    const prefersFinePointer =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(pointer: fine)").matches;
    if (prefersFinePointer) {
      el.style.cursor = "grab";
    }

    const s = state.current;

    const stopMomentum = () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };

    const onPointerDown = (e) => {
      // Endast mus – låt touch/pen vara native.
      const isMouse = e.pointerType === "mouse";
      s.isMouse = isMouse;
      if (!isMouse) return;

      if (isInteractive(e.target)) return;

      el.setPointerCapture?.(e.pointerId);
      s.active = true;
      s.dragging = false; // aktiveras först efter threshold
      s.startX = e.clientX;
      s.startY = e.clientY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.startScrollLeft = el.scrollLeft;
      s.startScrollTop = el.scrollTop;
      s.vx = 0;
      s.vy = 0;
      if (prefersFinePointer) el.style.cursor = "grabbing";
    };

    const onPointerMove = (e) => {
      if (!s.active || !s.isMouse) return;

      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      // Aktivera drag först efter threshold – annars låt klick passera.
      if (!s.dragging) {
        if (Math.hypot(dx, dy) < activateThreshold) return;
        s.dragging = true;
        el.style.userSelect = "none"; // från och med nu förhindrar vi markering
      }

      const prevX = s.lastX;
      const prevY = s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.vx = e.clientX - prevX;
      s.vy = e.clientY - prevY;

      // När vi *verkligen* drar – förhindra textselektion m.m.
      e.preventDefault();

      if (axis !== "y") el.scrollLeft = s.startScrollLeft - dx;
      if (axis !== "x") el.scrollTop = s.startScrollTop - dy;
    };

    const finishDrag = () => {
      s.active = false;
      if (prefersFinePointer) el.style.cursor = "grab";
      el.style.userSelect = "";

      if (!s.dragging) {
        // Ingen riktig drag – låt det betraktas som klick (vi gjorde ingen preventDefault före threshold)
        return;
      }
      s.dragging = false;

      if (!momentum) return;

      let vx = Math.max(Math.min(s.vx, 40), -40);
      let vy = Math.max(Math.min(s.vy, 40), -40);
      const decay = 0.95;

      if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) return;

      const step = () => {
        vx *= decay;
        vy *= decay;

        if (axis !== "y") el.scrollLeft -= vx;
        if (axis !== "x") el.scrollTop -= vy;

        if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
          stopMomentum();
          return;
        }
        s.raf = requestAnimationFrame(step);
      };

      stopMomentum();
      s.raf = requestAnimationFrame(step);
    };

    const onPointerUp = () => {
      if (!s.isMouse) return;
      finishDrag();
    };
    const onPointerCancel = onPointerUp;
    const onLostPointerCapture = onPointerUp;

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp, { passive: true });
    el.addEventListener("pointercancel", onPointerCancel, { passive: true });
    el.addEventListener("lostpointercapture", onLostPointerCapture, {
      passive: true,
    });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("lostpointercapture", onLostPointerCapture);
      stopMomentum();
      if (prefersFinePointer) el.style.cursor = "";
      el.style.touchAction = "";
      el.style.userSelect = "";
    };
  }, [axis, momentum, disabled, activateThreshold]);

  return { ref };
}
