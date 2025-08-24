import React, { createContext, useState, useEffect, useContext } from "react";
import { useSpring, animated } from "@react-spring/web";

export const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved; // manuellt val vinner
    } catch {}
    // Default = mörkt (även om OS säger ljust)
    return "dark";
  });

  // Sätt attributet på <html>. Vi skriver INTE till localStorage här.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Följ OS om (och bara om) användaren inte gjort ett manuellt val
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;

    const onChange = (e) => {
      const manual = localStorage.getItem("theme");
      if (manual !== "light" && manual !== "dark") {
        setTheme(e.matches ? "dark" : "light");
      }
    };

    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  // Enda stället vi skriver theme till localStorage = när användaren togglar
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      try { localStorage.setItem("theme", next); } catch {}
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Small animated toggle (oförändrad förutom att den använder context ovan)
const ThemeToggle = () => {
  const { theme, toggleTheme } = useContext(ThemeContext);
  const styles = useSpring({
    transform: theme === "light" ? "translateX(0%)" : "translateX(100%)",
    config: { tension: 220, friction: 22 },
  });

  return (
    <div
      onClick={toggleTheme}
      title={theme === "light" ? "Byt till mörkt läge" : "Byt till ljust läge"}
      style={{
        width: 56,
        height: 28,
        borderRadius: 20,
        padding: 3,
        margin: "0 8px",
        background: theme === "light" ? "#e6e6e6" : "#2f2f2f",
        display: "inline-flex",
        alignItems: "center",
        position: "relative",
        cursor: "pointer",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)",
      }}
      aria-label="Växla tema"
    >
      <animated.div
        style={{
          ...styles,
          width: 22,
          height: 22,
          borderRadius: 999,
          background: theme === "light" ? "#fff" : "#111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 14 }}>{theme === "light" ? "☀️" : "🌙"}</span>
      </animated.div>
    </div>
  );
};

export default ThemeToggle;
