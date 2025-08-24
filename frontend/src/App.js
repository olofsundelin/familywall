import React, { useEffect, useState } from "react";
import CalendarGrid from "./components/CalendarGrid";
import ShoppingList from "./components/ShoppingList";
import MealPlan from "./components/MealPlan";
import { ThemeProvider } from "./components/ThemeContext";
import "./App.css";
import "./components/themes.css";
import SlideshowOverlay from "./SlideshowOverlay";
import { useWallRefresh } from "./useWallRefresh";
import BootGate from "./BootGate.jsx";
import "./splash.css"; // stil för splash/bootgate
import { useCallback } from "react";
import { useRefreshBusEffect } from "./hooks/useRefreshBusEffect";
import { onRefresh } from "./refreshBus";
import useMidnightRefresh from "./hooks/useMidnightRefresh";
export default function App() {
  const [events, setEvents] = useState([]);
  const [presenceEnabled, setPresenceEnabled] = useState(false);
  
  // Tillåt env, annars same-origin (fixar tom sträng-problemet)
  const API_BASE =
    process.env.REACT_APP_API_BASE_URL ?? window.location.origin;

  // Lyssna på wall_state och trigga refresh av vyer
  useWallRefresh();
  useMidnightRefresh();
  // Hämta events och försök igen om API är nere
  useEffect(() => {
    let retryTimer;
    const fetchEvents = () => {
      fetch(`${API_BASE.replace(/\/+$/, "")}/api/ai/events`)
        .then((res) => {
          if (!res.ok) throw new Error("API-svar ej OK");
          return res.json();
        })
        .then((data) => {
          setEvents(data);
          console.log("✅ Event-data hämtad");
        })
        .catch(() => {
          console.warn("⚠️ API inte tillgängligt, försöker igen om 30 sek...");
          retryTimer = setTimeout(fetchEvents, 30000);
        });
    };

    fetchEvents();
    return () => clearTimeout(retryTimer);
  }, [API_BASE]);
  const refetchEvents = useCallback(() => {
    fetch(`${API_BASE.replace(/\/+$/, "")}/api/ai/events`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setEvents)
      .catch(() => {});
  }, [API_BASE]);
  useEffect(() => onRefresh(refetchEvents), [refetchEvents]);
  return (
    <ThemeProvider>
      {/* BootGate visar splash tills backend är redo */}
      <BootGate apiBase={API_BASE}>
        <div className="app-container">
          <div className="calendar-section">
            <CalendarGrid events={events} />
          </div>

          <div className="sidebar-section">
            <div className="meal-plan">
              <MealPlan />
            </div>
            <div className="shopping-list">
              <ShoppingList />
            </div>
          </div>

          {!presenceEnabled && (
            <button
              className="presence-btn"
              onClick={() => setPresenceEnabled(true)}
              style={{
                position: "fixed",
                bottom: 24,
                left: 24,
                zIndex: 10000,
                padding: "8px 12px",
                borderRadius: 8,
              }}
            >
              Aktivera närvarosensor
            </button>
          )}

          {/* Skicka med API_BASE till bildspelet */}
          <SlideshowOverlay presenceEnabled={presenceEnabled} apiBase={API_BASE} />
        </div>
      </BootGate>
    </ThemeProvider>
  );
}
