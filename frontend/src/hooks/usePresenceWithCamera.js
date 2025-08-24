import { useEffect, useRef, useState } from "react";

/**
 * usePresenceWithCamera
 * - Upptäcker närvaro via ELLER (rörelse || ansikte)
 * - Faller tillbaka till ENBART rörelse om FaceDetector inte finns
 *
 * Options:
 *  enabled: boolean
 *  motion: {
 *    sampleWidth?: number (default 80)
 *    sampleHeight?: number (default 60)
 *    thresholdRatio?: number (default 0.005 == 0.5%)
 *    hitsToTrigger?: number (default 3)
 *    frameIntervalMs?: number (default 120)
 *  }
 *  face: {
 *    enabled?: boolean (default true)
 *    detectEveryNFrames?: number (default 5)
 *    holdMs?: number (default 2500)
 *  }
 */
export default function usePresenceWithCamera(opts = {}) {
  const { enabled = false, motion = {}, face = {} } = opts;

  const sampleWidth = motion.sampleWidth ?? 80;
  const sampleHeight = motion.sampleHeight ?? 60;
  const thresholdRatio = motion.thresholdRatio ?? 0.005; // 0.5%
  const hitsToTrigger = motion.hitsToTrigger ?? 3;
  const frameIntervalMs = motion.frameIntervalMs ?? 120;

  const faceEnabled = face.enabled ?? true;
  const detectEveryNFrames = face.detectEveryNFrames ?? 5;
  const faceHoldMs = face.holdMs ?? 2500;

  const [present, setPresent] = useState(false);

  // video/canvas refs
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  // motion
  const prevFrameRef = useRef(null);
  const hitsRef = useRef(0);
  const loopIdRef = useRef(null);
  const tickTimerRef = useRef(null);
  const frameCountRef = useRef(0);

  // face
  const faceDetectorRef = useRef(null);
  const lastFaceSeenAtRef = useRef(0);

  const stop = () => {
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (loopIdRef.current && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(loopIdRef.current);
      loopIdRef.current = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks?.() ?? []) t.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.remove();
      videoRef.current = null;
    }
    prevFrameRef.current = null;
    hitsRef.current = 0;
    frameCountRef.current = 0;
    setPresent(false);
    console.log("[usePresenceWithCamera] 🛑 stop()");
  };

  useEffect(() => {
    console.log(
      `[usePresenceWithCamera] 🔁 enabled: ${enabled} | delta ms sedan sist: ${Date.now() % 1e13}`
    );

    if (!enabled) {
      stop();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // starta kamera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;
        streamRef.current = stream;

        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        videoRef.current = video;

        // downsample-canvas för rörelse
        const canvas = document.createElement("canvas");
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        canvasRef.current = canvas;
        ctxRef.current = ctx;

        // FaceDetector (om tillgängligt)
        if (faceEnabled && "FaceDetector" in window) {
          try {
            // @ts-ignore
            faceDetectorRef.current = new window.FaceDetector({
              fastMode: true,
              maxDetectedFaces: 1,
            });
            console.log("[usePresenceWithCamera] 🙂 FaceDetector tillgänglig.");
          } catch (e) {
            console.warn("[usePresenceWithCamera] FaceDetector init misslyckades:", e);
            faceDetectorRef.current = null;
          }
        } else if (faceEnabled) {
          console.log("[usePresenceWithCamera] 🙃 FaceDetector saknas — kör endast rörelse.");
        }

        // loop
        const tick = () => {
          if (!videoRef.current || !ctxRef.current) return;

          frameCountRef.current += 1;

          // rita aktuell frame nedskalat
          ctxRef.current.drawImage(videoRef.current, 0, 0, sampleWidth, sampleHeight);
          const curr = ctxRef.current.getImageData(0, 0, sampleWidth, sampleHeight).data;

          let diffCount = 0;
          const prev = prevFrameRef.current;

          // Rörelsedetektering (jämför luma mellan frames)
          if (prev) {
            for (let i = 0; i < curr.length; i += 4) {
              const y1 = (prev[i] * 299 + prev[i + 1] * 587 + prev[i + 2] * 114) / 1000;
              const y2 = (curr[i] * 299 + curr[i + 1] * 587 + curr[i + 2] * 114) / 1000;
              if (Math.abs(y2 - y1) > 18) diffCount++;
            }
          }
          prevFrameRef.current = new Uint8ClampedArray(curr);

          const totalSamples = sampleWidth * sampleHeight;
          const diffRatio = prev ? diffCount / totalSamples : 0;

          if (prev && diffRatio >= thresholdRatio) {
            hitsRef.current = Math.min(hitsRef.current + 1, hitsToTrigger);
          } else if (prev && diffRatio < thresholdRatio * 0.6) {
            // enkel hysteresis
            hitsRef.current = 0;
          }

          // Ansikte (glesare cadence)
          if (faceDetectorRef.current && (frameCountRef.current % detectEveryNFrames === 0)) {
            (async () => {
              try {
                const faces = await faceDetectorRef.current.detect(videoRef.current);
                if (faces && faces.length > 0) {
                  lastFaceSeenAtRef.current = Date.now();
                }
              } catch (e) {
                console.warn("[usePresenceWithCamera] FaceDetector.detect fel — stänger av:", e);
                faceDetectorRef.current = null;
              }
            })();
          }

          const faceRecentlySeen =
            faceDetectorRef.current &&
            Date.now() - lastFaceSeenAtRef.current < faceHoldMs;

          const moving = hitsRef.current >= hitsToTrigger;
          const nextPresent = Boolean(moving || faceRecentlySeen);

          console.log(
            `[usePresenceWithCamera] 📊 diffRatio≈${(diffRatio * 100).toFixed(2)}% | tröskel ${(thresholdRatio * 100).toFixed(1)}% | hits=${hitsRef.current}/${hitsToTrigger} | samples=${totalSamples}${faceDetectorRef.current ? ` | face=${faceRecentlySeen ? "✅" : "–"}` : ""}`
          );

          setPresent((old) => {
            if (old !== nextPresent) {
              console.log("[usePresenceWithCamera] present ändrad:", nextPresent);
            }
            return nextPresent;
          });
        };

        // setInterval funkar stabilt i alla moderna browsers
        tickTimerRef.current = setInterval(tick, frameIntervalMs);
        console.log("[usePresenceWithCamera] ▶️ loop startad.");
      } catch (err) {
        console.error("[usePresenceWithCamera] ❌ Kunde inte starta kamera:", err);
        stop();
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    sampleWidth,
    sampleHeight,
    thresholdRatio,
    hitsToTrigger,
    frameIntervalMs,
    faceEnabled,
    detectEveryNFrames,
    faceHoldMs,
  ]);

  return { present };
}
