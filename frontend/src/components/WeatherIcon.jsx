// src/components/WeatherIcon.jsx
import React from "react";

/** Bas: enkel ikonbyggare med currentColor så färg styrs externt */
const Svg = ({ children, size = 24, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    role="img"
    aria-label={title || "weather icon"}
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    stroke="currentColor"
    strokeWidth="0"
  >
    {children}
  </svg>
);

/* Små ikonbyggstenar */
const Sun = (props) => (
  <Svg {...props} title="sol">
    <circle cx="12" cy="12" r="5" />
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="12" y1="1" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="23" />
      <line x1="1" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="23" y2="12" />
      <line x1="4.2" y1="4.2" x2="6.5" y2="6.5" />
      <line x1="17.5" y1="17.5" x2="19.8" y2="19.8" />
      <line x1="4.2" y1="19.8" x2="6.5" y2="17.5" />
      <line x1="17.5" y1="6.5" x2="19.8" y2="4.2" />
    </g>
  </Svg>
);

const Cloud = (props) => (
  <Svg {...props} title="moln">
    <path d="M7.5 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.7-1.4A4.3 4.3 0 0 1 18.5 18H7.5z" />
  </Svg>
);

const SunBehindCloud = (props) => (
  <Svg {...props} title="sol med moln">
    <g opacity="0.85"><Sun size={0} /></g>
    <g transform="translate(-2 -2)">
      <circle cx="9" cy="9" r="3.5" />
    </g>
    <path d="M7.5 19a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.3A4 4 0 0 1 17.8 19H7.5z" />
  </Svg>
);

const Fog = (props) => (
  <Svg {...props} title="dimma">
    <Cloud />
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="15.5" x2="20" y2="15.5" />
      <line x1="3" y1="18.5" x2="21" y2="18.5" />
    </g>
  </Svg>
);

const Raindrops = () => (
  <g>
    <path d="M10 21c-.8 0-1.3-.8-.9-1.5l1.1-1.9c.2-.4.8-.4 1 0l1.1 1.9c.4.7-.1 1.5-.9 1.5z" />
    <path d="M16 21c-.8 0-1.3-.8-.9-1.5l1.1-1.9c.2-.4.8-.4 1 0l1.1 1.9c.4.7-.1 1.5-.9 1.5z" />
  </g>
);

const Snowflakes = () => (
  <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <g transform="translate(9.5,18)">
      <line x1="0" y1="-2" x2="0" y2="2" />
      <line x1="-1.7" y1="-1" x2="1.7" y2="1" />
      <line x1="1.7" y1="-1" x2="-1.7" y2="1" />
    </g>
    <g transform="translate(15.5,18)">
      <line x1="0" y1="-2" x2="0" y2="2" />
      <line x1="-1.7" y1="-1" x2="1.7" y2="1" />
      <line x1="1.7" y1="-1" x2="-1.7" y2="1" />
    </g>
  </g>
);

const Lightning = () => (
  <path d="M12 12h4l-4 8 1.5-5H10l2-3z" />
);

/** Kombinationsikoner */
const CloudRain = (props) => (
  <Svg {...props} title="regn">
    <Cloud />
    <g transform="translate(0,-2)"><Raindrops /></g>
  </Svg>
);

const CloudSnow = (props) => (
  <Svg {...props} title="snö">
    <Cloud />
    <Snowflakes />
  </Svg>
);

const CloudSleet = (props) => (
  <Svg {...props} title="blötsnö">
    <Cloud />
    <g transform="translate(0,-2)">
      <Raindrops />
      <g opacity="0.9"><Snowflakes /></g>
    </g>
  </Svg>
);

const Thunder = (props) => (
  <Svg {...props} title="åska">
    <Cloud />
    <g transform="translate(2,2)"><Lightning /></g>
  </Svg>
);

const Showers = (props) => (
  <Svg {...props} title="skurar">
    <SunBehindCloud />
    <g transform="translate(0,-2)"><Raindrops /></g>
  </Svg>
);

/** Map Wsymb2 (1–27) -> ikonkomponent */
export default function WeatherIcon({ code, size = 24 }) {
  const common = { size };
  switch (code) {
    case 1: return <Sun {...common} />;
    case 2: return <SunBehindCloud {...common} />;          // nearly clear
    case 3: return <SunBehindCloud {...common} />;          // variable cloudiness
    case 4: return <SunBehindCloud {...common} />;          // halfclear
    case 5: return <Cloud {...common} />;                   // cloudy
    case 6: return <Cloud {...common} />;                   // overcast
    case 7: return <Fog {...common} />;                     // fog
    case 8: return <Showers {...common} />;                 // light rain showers
    case 9: return <Showers {...common} />;                 // moderate rain showers
    case 10: return <Showers {...common} />;                // heavy rain showers
    case 11: return <Thunder {...common} />;                // thunderstorm
    case 12: return <CloudSleet {...common} />;             // light sleet showers
    case 13: return <CloudSleet {...common} />;             // moderate sleet showers
    case 14: return <CloudSleet {...common} />;             // heavy sleet showers
    case 15: return <CloudSnow {...common} />;              // light snow showers
    case 16: return <CloudSnow {...common} />;              // moderate snow showers
    case 17: return <CloudSnow {...common} />;              // heavy snow showers
    case 18: return <CloudRain {...common} />;              // light rain
    case 19: return <CloudRain {...common} />;              // moderate rain
    case 20: return <CloudRain {...common} />;              // heavy rain
    case 21: return <Thunder {...common} />;                // thunder
    case 22: return <CloudSleet {...common} />;             // light sleet
    case 23: return <CloudSleet {...common} />;             // moderate sleet
    case 24: return <CloudSleet {...common} />;             // heavy sleet
    case 25: return <CloudSnow {...common} />;              // light snowfall
    case 26: return <CloudSnow {...common} />;              // moderate snowfall
    case 27: return <CloudSnow {...common} />;              // heavy snowfall
    default: return <Cloud {...common} />;
  }
}
