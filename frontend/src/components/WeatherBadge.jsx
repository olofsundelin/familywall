import React from "react";
import WeatherIcon from "./WeatherIcon";

export default function WeatherBadge({ code, temp }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      color: "white",
      padding: "6px 10px",
      borderRadius: 10,
      backdropFilter: "blur(2px)"
    }}>
      <WeatherIcon code={code} size={22} />
      <span style={{ fontSize: 18, lineHeight: 1 }}>{temp}°</span>
    </div>
  );
}