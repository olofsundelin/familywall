// src/SlideshowOverlay.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import WeatherBadge from "./components/WeatherBadge";
import usePresenceWithCamera from "./hooks/usePresenceWithCamera";

const IDLE_MS = 60_000;        // starta bildspel efter 60 s inaktivitet
const SLIDE_MS = 12_000;       // byt slide var 12 s
const FADE_MS = 800;
const WEATHER_REFRESH_MIN = 30;
const WEATHER_SLIDE_INTERVAL = 10;

// 🔎 Enkel logg-hjälpare
const DEBUG = true;
const log = (...args) => DEBUG && console.log("[SlideshowOverlay]", ...args);

/* -------------------- Idle-detektering -------------------- */
function useIdle(timeout = IDLE_MS) {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIdle(false);
    timerRef.current = setTimeout(() => setIdle(true), timeout);
  }, [timeout]);

  useEffect(() => {
    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
    const onAny = () => reset();
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));
    reset();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, onAny));
    };
  }, [reset]);

  return { idle, reset };
}

/* -------------------- Hjälpfunktioner -------------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchMeta(apiBase) {
  log("Hämtar pictures-meta…", { apiBase });
  const res = await fetch(`${apiBase}/api/pictures-meta`);
  if (!res.ok) throw new Error("Kunde inte hämta pictures-meta");
  const data = await res.json();
  const items = data.items || [];
  log("pictures-meta OK", { antal: items.length });
  return items;
}

function buildImageUrl(apiBase, file, targetW, targetH, q = 82) {
  const params = new URLSearchParams({
    file,
    w: String(Math.max(480, Math.round(targetW))),
    h: String(Math.max(480, Math.round(targetH))),
    q: String(q),
  });
  return `${apiBase}/api/picture?${params.toString()}`;
}

/* -------------------- Slidedeck (random) -------------------- */
// Slidetyper: { type: "single", file } eller { type: "pair", top, bottom }
function makeSlides(meta) {
  const portraits = shuffle(meta.filter(m => m.orientation === "portrait").map(m => m.file));
  const landscapes = shuffle(meta.filter(m => m.orientation === "landscape").map(m => m.file));

  const pairs = [];
  for (let i = 0; i + 1 < landscapes.length; i += 2) {
    pairs.push({ top: landscapes[i], bottom: landscapes[i + 1] });
  }

  const slides = [];
  while (portraits.length || pairs.length) {
    const choices = [];
    if (portraits.length) choices.push("single");
    if (pairs.length) choices.push("pair");
    const pick = choices[Math.floor(Math.random() * choices.length)];
    if (pick === "single") slides.push({ type: "single", file: portraits.pop() });
    else slides.push({ type: "pair", ...pairs.pop() });
  }
  const out = shuffle(slides);
  log("Slides byggda", { antal: out.length });
  return out;
}

/* -------------------- Väder-hook -------------------- */
function useWeatherNow(apiBase) {
  const [now, setNow] = useState(null);

  const load = useCallback(() => {
    log("Hämtar väder /now…");
    return fetch(`${apiBase}/api/weather/now`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && typeof d.temp === "number") {
          setNow({ code: d.code, temp: Math.round(d.temp) });
          log("Väder uppdaterat", { code: d.code, temp: Math.round(d.temp) });
        } else {
          log("Väder: tomt svar eller fel format");
        }
      })
      .catch((e) => { log("Väderfel", e); });
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    let active = true;
    const tick = () => active && load();
    tick(); // direkt vid mount
    const t = setInterval(tick, WEATHER_REFRESH_MIN * 60 * 1000);
    return () => { active = false; clearInterval(t); };
  }, [apiBase, load]);

  return { now, refresh: load };
}

/* -------------------- Huvudkomponent -------------------- */
export default function SlideshowOverlay({ presenceEnabled, apiBase }) {
  const { idle, reset } = useIdle();
  const { present } = usePresenceWithCamera({ enabled: presenceEnabled });

  const [slides, setSlides] = useState([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);

  const { now: weatherNow, refresh: refreshWeather } = useWeatherNow(apiBase);

  // Logga start
  useEffect(() => {
    log("Mount", { presenceEnabled, apiBase });
    return () => log("Unmount");
  }, [presenceEnabled, apiBase]);

  // Logga förändringar i styrflagga & hook-status
  useEffect(() => { log("presenceEnabled ändrad", presenceEnabled); }, [presenceEnabled]);
  useEffect(() => { log("present ändrad (kamerahook)", present); }, [present]);
  useEffect(() => { log("idle ändrad", idle); }, [idle]);

  // visa/dölj overlay
  useEffect(() => {
    setVisible(idle);
    log("Overlay synlighet", { visible: idle });
  }, [idle]);

  // stäng overlay om kamerahook säger närvaro
  useEffect(() => {
    if (!present) return;
    log("Närvaro detekterad — stänger overlay och nollställer idle-timer");
    setVisible(false);
    reset();
  }, [present, reset]);

  // hämta metadata och bygg random slides (med retry om API inte är uppe ännu)
  useEffect(() => {
    if (!apiBase) return;
    let mounted = true;
    let retry;

    const load = () => {
      fetchMeta(apiBase)
        .then((meta) => {
          if (!mounted) return;
          const s = makeSlides(meta);
          setSlides(s);
          setIdx(0);
          log("Slides inlästa", { antal: s.length });
        })
        .catch((err) => {
          log("Fel vid hämtning av pictures-meta. Nytt försök om 30s.", err);
          // försök igen om 30 s
          retry = setTimeout(load, 30_000);
        });
    };

    load();
    return () => { mounted = false; clearTimeout(retry); };
  }, [apiBase]);

  // auto-advance
  useEffect(() => {
    if (!visible || slides.length === 0) return;
    const t = setInterval(() => {
      setIdx((prev) => {
        const next = (prev + 1) % slides.length;
        log("Slide advance", { prev, next, total: slides.length });
        return next;
      });
      setFadeKey((k) => k + 1);
    }, SLIDE_MS);
    return () => clearInterval(t);
  }, [visible, slides]);

  // väder-refresh var N:e slide
  useEffect(() => {
    if (!visible) return;
    if (idx % WEATHER_SLIDE_INTERVAL === 0) {
      log("Uppdaterar väder pga slide-index", { idx });
      refreshWeather();
    }
  }, [idx, visible, refreshWeather]);

  // stäng overlay på första interaktion
  useEffect(() => {
    if (!visible) return;
    const close = () => { 
      log("Användarinteraktion — stänger overlay och nollställer idle-timer");
      setVisible(false); 
      reset(); 
    };
    const events = ["pointerdown","keydown","touchstart","wheel"];
    events.forEach((e) => window.addEventListener(e, close, { passive: true, once: true }));
    return () => events.forEach((e) => window.removeEventListener(e, close));
  }, [visible, reset]);

  // förladda nästa slide (tyst loggning – bara vid behov)
  useEffect(() => {
    if (!visible || slides.length === 0) return;
    const nextSlide = slides[(idx + 1) % slides.length];
    const vw = window.innerWidth, vh = window.innerHeight;
    try {
      if (nextSlide.type === "single") {
        const img = new Image();
        img.src = buildImageUrl(apiBase, nextSlide.file, vw, vh);
      } else {
        const hHalf = Math.max(1, Math.round(vh / 2));
        const img1 = new Image();
        img1.src = buildImageUrl(apiBase, nextSlide.top, vw, hHalf);
        const img2 = new Image();
        img2.src = buildImageUrl(apiBase, nextSlide.bottom, vw, hHalf);
      }
    } catch (e) {
      log("Fel vid förladdning av nästa slide", e);
    }
  }, [visible, slides, idx, apiBase]);

  if (!visible || slides.length === 0) return null;
  const slide = slides[idx];

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const halfH = Math.max(1, Math.round(vh / 2));

  return (
    <div
      aria-label="Skärmsläckare bildspel"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "black", cursor: "none" }}
    >
      {slide.type === "single" ? (
        <img
          key={fadeKey}
          src={buildImageUrl(apiBase, slide.file, vw, vh)}
          alt="Family Wall slideshow"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", opacity: 0, animation: `fadeIn ${FADE_MS}ms ease forwards`,
          }}
          draggable={false}
          onLoad={() => log("Bild laddad", { file: slide.file })}
          onError={(e) => log("Bild FEL", { file: slide.file, error: e?.message })}
        />
      ) : (
        <>
          <img
            key={`${fadeKey}-top`}
            src={buildImageUrl(apiBase, slide.top, vw, halfH)}
            alt="Family Wall slideshow (top)"
            style={{
              position: "absolute", left: 0, top: 0, right: 0, height: "50%", width: "100%",
              objectFit: "cover", opacity: 0, animation: `fadeIn ${FADE_MS}ms ease forwards`,
            }}
            draggable={false}
            onLoad={() => log("Bild laddad (top)", { file: slide.top })}
            onError={(e) => log("Bild FEL (top)", { file: slide.top, error: e?.message })}
          />
          <img
            key={`${fadeKey}-bottom`}
            src={buildImageUrl(apiBase, slide.bottom, vw, halfH)}
            alt="Family Wall slideshow (bottom)"
            style={{
              position: "absolute", left: 0, bottom: 0, right: 0, height: "50%", width: "100%",
              objectFit: "cover", opacity: 0, animation: `fadeIn ${FADE_MS}ms ease forwards`,
            }}
            draggable={false}
            onLoad={() => log("Bild laddad (bottom)", { file: slide.bottom })}
            onError={(e) => log("Bild FEL (bottom)", { file: slide.bottom, error: e?.message })}
          />
        </>
      )}

      {/* Väder + klocka nere till höger */}
      <div style={{ position: "absolute", right: 24, bottom: 24, display: "flex", gap: 12, alignItems: "center" }}>
        {weatherNow && <WeatherBadge code={weatherNow.code} temp={weatherNow.temp} />}
        <div style={{ color: "white", fontSize: 32, opacity: 0.85, userSelect: "none", pointerEvents: "none" }}>
          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
