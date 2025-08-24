import React, { useState, useEffect, useCallback } from "react";
import "./MealPlan.css";
import { playSound } from "../utils/playSound";
import useDragScroll from "../hooks/useDragScroll";
import useRefreshBusEffect from "../hooks/useRefreshBusEffect";

// Använd 3443-gateway om sidan inte redan körs på 3443
const API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  (window.location.port === "3443"
    ? ""
    : `https://${window.location.hostname}:3443`);

const api = (path) => `${API_BASE}${path}`;

// ---- Hjälp: ISO-vecka (samma som tidigare) ----
function getWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

// ---- Hjälp: robust fetch som alltid försöker parsa JSON ----
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data && (data.message || data.error || data.detail);
    throw new Error(msg || `HTTP ${res.status} ${res.statusText}`);
  }
  return data;
}

// ---- “Likes” lokalt (ersätter Supabase likes tills vidare) ----
const LS_LIKES_KEY = "meal_likes_v1";
function readLikes() {
  try {
    return JSON.parse(localStorage.getItem(LS_LIKES_KEY)) || [];
  } catch {
    return [];
  }
}
function writeLikes(allLikes) {
  try {
    localStorage.setItem(LS_LIKES_KEY, JSON.stringify(allLikes));
  } catch {
    /* noop */
  }
}

function MealPlan() {
  const { ref } = useDragScroll({ axis: "y", momentum: true });
  const [weekNumber, setWeekNumber] = useState(getWeekNumber(new Date()));
  const [mealData, setMealData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [likedMeals, setLikedMeals] = useState([]);

  // ---- Hämta likes för vald vecka från localStorage ----
  const fetchLikedMeals = useCallback((week) => {
    const all = readLikes();
    setLikedMeals(all.filter((l) => l.vecka === week));
  }, []);

  // ---- Hämta veckans matsedel från backend (/api/ai/mealplan) ----
  const loadWeek = useCallback(
    async (week) => {
      setLoading(true);
      setError(null);
      setMealData(null);

      try {
        // Backend får gärna svara {status:"ok", data:{...}} eller bara {...}
        const resp = await fetchJSON(api(`/api/ai/mealplan?vecka=${week}`));
        const payload =
          resp && typeof resp === "object" && "status" in resp
            ? (resp.status === "ok" ? resp.data : null)
            : resp;

        if (!payload || !payload.dagar) {
          setError("Ingen matsedel hittades för den veckan.");
        } else {
          setMealData(payload);
          fetchLikedMeals(week);
        }
      } catch (e) {
        setError("Kunde inte hämta veckans matsedel.");
      } finally {
        setLoading(false);
      }
    },
    [fetchLikedMeals]
  );

  useEffect(() => {
    loadWeek(weekNumber);
  }, [weekNumber, loadWeek]);

  // 🔔 Koppla refresh-bussen till refetch
  const refetchWeek = useCallback(() => {
    loadWeek(weekNumber);
  }, [loadWeek, weekNumber]);
  useRefreshBusEffect(refetchWeek);

  // ---- Gilla/ogilla middag (lokalt) ----
  async function toggleLike(titel, dag) {
    const all = readLikes();
    const idx = all.findIndex(
      (l) => l.titel === titel && l.dag === dag && l.vecka === weekNumber
    );

    if (idx >= 0) {
      all.splice(idx, 1);
    } else {
      all.push({ id: `${weekNumber}:${dag}:${titel}`, titel, dag, vecka: weekNumber });
    }
    writeLikes(all);
    setLikedMeals(all.filter((l) => l.vecka === weekNumber));
  }

  // ---- Byt middag via backend (/api/ai/byt-middag) ----
  async function replaceDinner(dagNamn) {
    const confirmed = window.confirm(`Vill du byta ut middagen för ${dagNamn}?`);
    if (!confirmed) return;

    setStatusMsg("🔁 Byter ut middag...");
    try {
      const data = await fetchJSON(api("/api/ai/byt-middag"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ vecka: weekNumber, dag: dagNamn }),
      });

      if (data.status === "ok" && data.newDinner) {
        setMealData((prev) => ({
          ...prev,
          dagar: prev.dagar.map((dag) =>
            dag.dag === dagNamn ? { ...dag, middag: data.newDinner } : dag
          ),
        }));
        playSound("new-dish.mp3");
        setStatusMsg("✅ Middag uppdaterad!");
      } else {
        setStatusMsg("❌ Misslyckades: " + (data.message || "Okänt fel"));
      }
    } catch (err) {
      setStatusMsg("❌ Fel vid anrop: " + err.message);
    }
  }

  const handlePreviousWeek = () => setWeekNumber((prev) => Math.max(prev - 1, 1));
  const handleNextWeek = () => setWeekNumber((prev) => prev + 1);

  // ---- Skapa ny veckomeny via backend (/api/ai/planera) ----
  async function regenerateMealPlan() {
    const confirmed = window.confirm(
      "Är du säker på att du vill skapa en ny veckomeny? Detta ersätter den nuvarande."
    );
    if (!confirmed) return;

    setStatusMsg("Skapar ny veckomeny...");
    setLoading(true);
    try {
      const data = await fetchJSON(api("/api/ai/planera"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({}),
      });

      if (data.status !== "ok") {
        throw new Error(data.message || "Kunde inte skapa matsedel.");
      }
      await loadWeek(weekNumber); // refetcha direkt
      playSound("new-menu.mp3");
      setStatusMsg("✅ Ny matsedel skapad!");
    } catch (err) {
      setStatusMsg("❌ Fel vid anrop: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="meal-plan-container">
      <div className="week-selector">
        <button onClick={handlePreviousWeek}>‹</button>
        <h3>Matsedel – Vecka {weekNumber}</h3>
        <button onClick={handleNextWeek}>›</button>
      </div>

      <button onClick={regenerateMealPlan} className="regenerate-btn">
        🔁 Skapa ny veckomeny
      </button>
      {statusMsg && <p className="status-msg">{statusMsg}</p>}

      {loading && <p>Laddar...</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && mealData && Array.isArray(mealData.dagar) && (
        mealData.dagar.map((dag, idx) => {
          const liked = likedMeals.some(
            (like) =>
              like.titel === dag.middag?.titel &&
              like.dag === dag.dag &&
              like.vecka === weekNumber
          );

          return (
            <div key={`${dag.dag}-${idx}`} className="meal-day">
              <strong>{dag.dag}</strong>

              <div className="meal">
                <em>Lunch:</em>{" "}
                {dag.lunch?.titel ? (
                  <>
                    {dag.lunch.titel}
                    {dag.lunch.recept === null && dag.lunch.kalorier === null && (
                      <span className="heart-icon" title="Skollunch"> 🏫</span>
                    )}
                  </>
                ) : (
                  "–"
                )}
                {dag.lunch?.recept && (
                  <a href={dag.lunch.recept} target="_blank" rel="noopener noreferrer">
                    🔗
                  </a>
                )}
              </div>

              <div className="meal">
                <em>Middag:</em> {dag.middag?.titel || "–"}{" "}
                {dag.middag?.titel && (
                  <>
                    <span
                      className="heart-icon"
                      style={{ color: liked ? "red" : "gray", cursor: "pointer" }}
                      onClick={() => toggleLike(dag.middag.titel, dag.dag)}
                      title="Gilla denna middag"
                    >
                      {liked ? "❤️" : "🤍"}
                    </span>

                    <span
                      className="heart-icon"
                      style={{ cursor: "pointer", marginLeft: "8px" }}
                      onClick={() => replaceDinner(dag.dag)}
                      title="Byt ut denna middag"
                    >
                      🔁
                    </span>
                  </>
                )}
                {dag.middag?.recept && (
                  <a href={dag.middag.recept} target="_blank" rel="noopener noreferrer">
                    🔗
                  </a>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default MealPlan;
