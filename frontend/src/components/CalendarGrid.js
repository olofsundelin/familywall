// src/components/CalendarGrid.js
import React, { useState, useEffect, useRef, useContext } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  format,
  isToday,
  getWeek,
  isSameDay,
} from 'date-fns';
import sv from 'date-fns/locale/sv';
import axios from 'axios';
import './CalendarGrid.css';
import { ThemeContext } from './ThemeContext';
import { useSpring, animated } from '@react-spring/web';
import HeaderClock from './HeaderClock';

const API_BASE = process.env.REACT_APP_API_BASE_URL || '';
const ymdInTz = (d, tz = 'Europe/Stockholm') => {
  const dtf = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

/** En hjälpare för att avgöra om något “ser ut som” en Skola24-lektion */
const SUBJECT_WORDS = [
  'sv','ma','no','so','en','bl','mu','musik','bild','sl','slöjd','te','tk',
  'rast','lunch','elevens val','hk','hemkunskap','idh','idrott','gympa','språkhuset'
];

const looksLikeSchoolLesson = (summary = '') => {
  const s = summary.trim().toLowerCase();
  // korta ämneskoder / typiska ord
  if (SUBJECT_WORDS.some(k => s === k || s.startsWith(k + ' '))) return true;
  // ofta 2–4 bokstäver (SV, MA, IDH, NO…)
  if (/^[a-zåäö]{2,4}$/i.test(summary)) return true;
  return false;
};

/** Försök hitta en klassnyckel (utan att hårdkoda specifika koder) */
const getClassKey = (ev) => {
  const cal = (ev.calendar || '').trim();
  const desc = (ev.description || '').trim();

  // 1) Klasskod förekommer ofta i kalendernamnet före första "("
  const m1 = cal.match(/^([^()]+)\s*\(/);
  if (m1) return m1[1].trim().toUpperCase();

  // 2) Klasskod i beskrivningen, t.ex. "SV FHT 2C MH16" eller "FSKC ..."
  //    Generiskt mönster: 1–2 siffror + bokstav, eller F/FSK/FSKC-varianter (svenska bokstäver tillåtna)
  const m2 = desc.match(/\b([0-9]{1,2}[A-ZÅÄÖ]|F(?:SK)?[A-ZÅÄÖ]?)\b/iu);
  if (m2) return m2[1].toUpperCase();

  // 3) Om inget hittas – behandla som generellt schema
  return null;
};

/** Idrott? (för grupp-ikonen) */
const isIdrott = (summary = '') => {
  const s = summary.toLowerCase();
  return s.includes('idh') || s.includes('idrott') || s.includes('gympa');
};

// Födelsedagar hämtas från backend för att undvika persondata i koden
// API: GET ${API_BASE}/api/birthdays -> { birthdays: [{date:'3/1', name:'Mormor'}, ...] }

const iconMap = [
  { keyword: 'karate',     icon: '🥋', color: '#ff6600' },
  { keyword: 'sopor',      icon: '🗑️', color: '#555' },
  { keyword: 'lets move it', icon: '🏑', color: '#0af' },
  { keyword: 'gympa',      icon: '🩳', color: '#a0f' },
  { keyword: 'idh',        icon: '🩳', color: '#a0f' },
  { keyword: 'fotboll',    icon: '⚽', color: '#1e90ff' },
  { keyword: 'skola',      icon: '🎒', color: '#ff6347' },
  { keyword: 'läkare',     icon: '🩺', color: '#3cb371' },
  { keyword: 'simning',    icon: '🏊', color: '#00bfff' },
];

const weatherIcons = {
  1: '☀️', 2: '🌤️', 3: '⛅', 4: '☁️', 5: '🌥️', 6: '🌫️',
  7: '🌦️', 8: '🌧️', 9: '🌧️💦', 10: '⛈️', 11: '🌦️', 12: '🌧️',
  13: '🌧️💧', 14: '🌩️', 15: '🌨️🌧️', 16: '🌨️', 17: '🌨️❄️💧',
  18: '🌨️', 19: '❄️', 20: '❄️🌨️❄️', 21: '🌨️❄️', 22: '🌨️❄️❄️',
  23: '🌨️❄️❄️❄️', 24: '🌧️❄️', 25: '🌧️🧊', 26: '🌨️💧', 27: '🌨️💧❄️',
};

async function fetchDayInfo(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const url = `https://sholiday.faboul.se/dagar/v2.1/${year}/${month}/${day}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const daginfo = data.dagar[0];

    return {
      isFlagDay: !!daginfo.flaggdag,
      flagReason: daginfo.flaggdag || null,
      isRedDay: daginfo['röd dag'] === 'Ja',
      holidayName: daginfo.helgdag || null,
    };
  } catch {
    return { isFlagDay: false, isRedDay: false, holidayName: null };
  }
}
// —— Karta overlay ——
const parseLatLng = (txt = '') => {
  // Fångar "63.9, 20.56" eller "lat:63.9 lon:20.56"
  const m = txt.match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/) ||
            txt.match(/lat[:=]\s*(-?\d{1,3}\.\d+).*?(lon|lng)[:=]\s*(-?\d{1,3}\.\d+)/i);
  if (!m) return null;
  // match 1,2 eller 1,3 beroende på regex-variant
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[3] || m[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
};

const getMapsEmbedUrl = (locationText = '') => {
  const coords = parseLatLng(locationText);
  if (coords) {
    const q = `${coords.lat},${coords.lng}`;
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  }
  // fallback: sök strängen
  return `https://www.google.com/maps?q=${encodeURIComponent(locationText)}&output=embed`;
};

const getMapsLink = (locationText = '') => {
  const coords = parseLatLng(locationText);
  const q = coords ? `${coords.lat},${coords.lng}` : locationText;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
};
const ymdLocal = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const isAllDay = (ev) => !!ev.start?.date;
function expandEventToDays(ev) {
  // Plocka ut start/end med fallbacks (tål både .date, .dateTime och rena strängar)
  const startISO =
    (isAllDay(ev) ? ev.start?.date : ev.start?.dateTime) ||
    ev.start || null;
  const endRaw =
    (isAllDay(ev) ? ev.end?.date : ev.end?.dateTime) ||
    ev.end || null;

  if (!startISO) return [];                // utan start kan vi inte göra något
  let start = new Date(
    typeof startISO === 'string' && startISO.length === 10 ? `${startISO}T00:00:00` : startISO
  );

  // Om end saknas → anta samma dag som start
  let end = endRaw
    ? new Date(
        typeof endRaw === 'string' && endRaw.length === 10 ? `${endRaw}T00:00:00` : endRaw
      )
    : new Date(start);

  // All‑day: Google end.date är EXKLUSIV → visa t.o.m. dagen före
  if (isAllDay(ev)) {
    end.setDate(end.getDate() - 1);
  } else {
    // Timade events som slutar 00:00 ska inte visas på slutdagen
    if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
      // men bara om end != start (annars ryker end)
      if (end.getTime() !== start.getTime()) end.setDate(end.getDate() - 1);
    }
  }

  if (end < start) end = new Date(start); // säkerställ minst en dag

  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push({ ...ev, __instanceDate: ymdLocal(cur) });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};
function CalendarGrid() {
  // === Theme via context (styr hela appen) ===
  const { theme, toggleTheme } = useContext(ThemeContext);
  const knobSpring = useSpring({
    transform: theme === 'light' ? 'translateX(0%)' : 'translateX(100%)',
    config: { tension: 220, friction: 22 },
  });

  // === State ===
  const [mapOverlay, setMapOverlay] = useState({ open: false, title: '', url: '' });
  const [currentStartDate, setCurrentStartDate] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [weatherData, setWeatherData] = useState({});
  const [bedtimeOverrides, setBedtimeOverrides] = useState(() => {
    const saved = localStorage.getItem('bedtimeOverrides');
    return saved ? JSON.parse(saved) : {};
  });
  const [bedtimeBaseDate, setBedtimeBaseDate] = useState(() => {
    const saved = localStorage.getItem('bedtimeBaseDate');
    return saved ? new Date(saved) : new Date(2025, 6, 27);
  });
  const [events, setEvents] = useState([]);
  const [birthdays, setBirthdays] = useState([]);
  const [scheduleCfg, setScheduleCfg] = useState({
    colorRules: [],
    classLabels: {},
  });
  const MAX_DESC_CHARS = 140; // justera smakligt
  const [expandedEvents, setExpandedEvents] = useState(() => new Set());

  const instanceId = (ev) =>
    (ev.id ? String(ev.id) : ev.summary) + '|' + (ev.__instanceDate || '');

  const isEventExpanded = (ev) => expandedEvents.has(instanceId(ev));
  const toggleEventExpand = (ev) => {
    const id = instanceId(ev);
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const [birthdayOverride, setBirthdayOverride] = useState(() => {
  return localStorage.getItem('birthdayOverride') === '1';
});
const toggleBirthdayOverride = () => {
  const next = !birthdayOverride;
  setBirthdayOverride(next);
  localStorage.setItem('birthdayOverride', next ? '1' : '0');
  alert(next ? '🎉 Födelsedagsläge PÅ (manuellt)' : 'Födelsedagsläge AV');
};
  // Hämta schemakonfig (match-regler + etiketter)
  useEffect(() => {
    let mounted = true;
    axios
      .get(`${API_BASE}/api/ai/schedule-config`)
      .then((res) => {
        if (!mounted) return;
        const cfg = res.data || {};
        setScheduleCfg({
          colorRules: Array.isArray(cfg.colorRules) ? cfg.colorRules : [],
          classLabels: cfg.classLabels || {},
        });
      })
      .catch(() => mounted && setScheduleCfg({ colorRules: [], classLabels: {} }));
    return () => {
      mounted = false;
    };
  }, []);
  const [isLandscape, setIsLandscape] = useState(() =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(orientation: landscape)').matches
);
useEffect(() => {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(orientation: landscape)');
  const onChange = (e) => setIsLandscape(e.matches);
  mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  return () => {
    mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange);
  };
}, []);
const visibleLimit = () => (isLandscape ? 2 : 4);

// Expandering per dag (Set av datumsträngar)
const [expandedDays, setExpandedDays] = useState(() => new Set());
const isDayExpanded = (dateStr) => expandedDays.has(dateStr);
const toggleDayExpand = (dateStr) => {
  setExpandedDays(prev => {
    const next = new Set(prev);
    next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
    return next;
  });
};
   
  const getClassLabel = (code) =>
    scheduleCfg.classLabels?.[code] ?? (code === 'SCHEMA' ? 'Schema' : 'Skolschema');

  // Generisk färgupplockning: hitta första färgregel som matchar “källsträngen”
  // (Vi kan skicka in t.ex. klasskoden eller event.source – det viktiga är att .includes träffar din schedule_config)
  const colorFor = (src) => {
    const rules = scheduleCfg.colorRules || [];
    const hit = rules.find((r) => src && r.includes && src.includes(r.includes));
    const varName = hit?.colorVar || '--default';
    return `var(${varName})`;
  };

  // Hämta födelsedagar en gång vid mount
  useEffect(() => {
    let mounted = true;
    axios
      .get(`${API_BASE}/api/ai/birthdays`)
      .then((res) => {
        if (!mounted) return;
        const list = Array.isArray(res.data?.birthdays) ? res.data.birthdays : [];
        setBirthdays(list);
      })
      .catch(() => mounted && setBirthdays([]));
    return () => {
      mounted = false;
    };
  }, []);
  // Expandering för klassgrupper (skolschema)
  const [expandedGroups, setExpandedGroups] = useState({}); // key: YYYY-MM-DD|CLASS

  const goToToday = () => {
    setCurrentStartDate(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };
  const [dayInfoMap, setDayInfoMap] = useState({});
  const [showMenu, setShowMenu] = useState(false);
  const [isMaximized, setIsMaximized] = useState(() => {
    const saved = localStorage.getItem('calendarIsMaximized');
    return saved ? JSON.parse(saved) : false;
  });
  const [lastRefreshTick, setLastRefreshTick] = useState(0); // auto-refresh trigger
  const menuRef = useRef(null);

  // Persist and body scroll lock when maximized
  useEffect(() => {
    localStorage.setItem('calendarIsMaximized', JSON.stringify(isMaximized));
    const prev = document.body.style.overflow;
    if (isMaximized) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = prev || '';
    return () => {
      document.body.style.overflow = prev || '';
    };
  }, [isMaximized]);

  // Auto-minimera efter 5 min inaktivitet + ESC-stöd
  useEffect(() => {
    let inactivityTimer;
    const resetTimer = () => {
      if (!isMaximized) return;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        setIsMaximized(false);
        localStorage.setItem('calendarIsMaximized', 'false');
      }, 5 * 60 * 1000);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && isMaximized) {
        setIsMaximized(false);
        localStorage.setItem('calendarIsMaximized', 'false');
      }
    };
    if (isMaximized) {
      resetTimer();
      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keydown', resetTimer);
      window.addEventListener('touchstart', resetTimer);
      window.addEventListener('keydown', onKey);
    }
    return () => {
      clearTimeout(inactivityTimer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [isMaximized]);

  // Auto-refresh var 5:e minut + när tabben får fokus
  useEffect(() => {
    const id = setInterval(() => setLastRefreshTick((t) => t + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const refreshOnFocus = () => setLastRefreshTick((t) => t + 1);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshOnFocus();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // === UI helpers ===
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleBedtime = (dateStr) => {
    const updated = { ...bedtimeOverrides };
    updated[dateStr] = updated[dateStr] === 'woman' ? 'man' : 'woman';
    setBedtimeOverrides(updated);
    localStorage.setItem('bedtimeOverrides', JSON.stringify(updated));
  };

  const getEventStyle = (summary = '') => {
    const lower = summary.toLowerCase();
    const match = iconMap.find(({ keyword }) => lower.includes(keyword));
    return match || { icon: '', color: '#666' };
  };

  const resetBedtimeOverrides = () => {
    setBedtimeOverrides({});
    localStorage.removeItem('bedtimeOverrides');
    alert('Alla manuella ändringar för läggning är nu återställda.');
  };

  const resetAllLocal = () => {
    localStorage.clear();
    alert('Alla lokala inställningar har rensats. Ladda om sidan.');
  };

  const shiftBedtimeBaseDate = (dateStr) => {
    setBedtimeBaseDate(new Date(dateStr));
    localStorage.setItem('bedtimeBaseDate', new Date(dateStr).toISOString());
    alert('Turordning startar nu från idag.');
  };

  const refreshWeather = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/weather`);
      setWeatherData(res.data);
      alert('Väderdata uppdaterad!');
    } catch {
      alert('Kunde inte uppdatera väderdata.');
    }
  };

  const reloadEverything = () => {
    setCurrentStartDate((d) => new Date(d));
    alert('Kalenderdata uppdateras...');
  };

  const showHelp = () => {
    alert('Symbolförklaringar:\n👨‍🍼 = Pappas läggning\n👩‍🍼 = Mammas läggning\n🎂 = Födelsedag\n🌧️ = Regn\n☀️ = Sol\n🥋 = Karate\n🗑️ = Sopor\n🩳 = Idrott.');
  };

  // === Data fetch on period change ===
  useEffect(() => {
    const periodStart = startOfWeek(currentStartDate, { weekStartsOn: 1 });
    const periodEnd = addDays(periodStart, (weeksToShow() * 7) - 1);

    const fetchEvents = async () => {
  try {
    const response = await axios.get(`${API_BASE}/api/ai/events`);
    const yStart = periodStart.getFullYear();
    const yEnd = periodEnd.getFullYear();
    const years = yStart === yEnd ? [yStart] : [yStart, yEnd];

    // 🎂 Födelsedagar som riktiga all‑day (date/end.date — samma dag)
    const birthdayEvents = years.flatMap((year) =>
      birthdays.map(({ date, name }) => {
        const [day, month] = date.split('/');
        const ds = `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`;
        return {
          summary: `🎂${name}`,
          start: { date: ds },
          end:   { date: ds },
          source: 'birthday',
        };
      })
    );

    // Slå ihop & expandera alla events till en instans per dag
    const merged = [...response.data, ...birthdayEvents];
    const expanded = merged.flatMap(expandEventToDays);

    // Sortera: dag → starttid
    expanded.sort((a, b) => {
      if (a.__instanceDate !== b.__instanceDate) {
        return a.__instanceDate.localeCompare(b.__instanceDate);
      }
      const ta = new Date(a.start?.dateTime || a.start?.date || a.__instanceDate).getTime();
      const tb = new Date(b.start?.dateTime || b.start?.date || b.__instanceDate).getTime();
      return ta - tb;
    });

    setEvents(expanded);
  } catch (error) {
    console.error('Kunde inte hämta kalenderdata', error);
  }
};
    const fetchWeather = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/weather`);
        setWeatherData(res.data);
      } catch (e) {
        console.error('Kunde inte ladda väderdata:', e);
      }
    };

    const fetchAllDayInfo = async () => {
      let day = new Date(periodStart);
      const promises = [];
      while (day <= periodEnd) {
        const dateStr = format(day, 'yyyy-MM-dd');
        promises.push(fetchDayInfo(dateStr).then((info) => ({ [dateStr]: info })));
        day = addDays(day, 1);
      }
      const results = await Promise.all(promises);
      setDayInfoMap(Object.assign({}, ...results));
    };

    fetchEvents();
    fetchWeather();
    fetchAllDayInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStartDate, isMaximized, lastRefreshTick, birthdays]);

  // === Helpers ===
  const weeksToShow = () => (isMaximized ? 6 : 3);

  // === Render helpers ===
  const renderDays = () => [
    <div key="v" className="calendar-cell header small">v.</div>,
    ...['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'].map((day, i) => (
      <div key={i} className="calendar-cell header small">{day}</div>
    )),
  ];

  const renderCells = () => {
    const periodStart = startOfWeek(currentStartDate, { weekStartsOn: 1 });
    const cells = [];
    let day = new Date(periodStart);
    const todayStr = ymdInTz(new Date());
    // Tål start som sträng eller objekt {dateTime} / {date}
    const timeStr = (val) => {
      if (!val) return '';
      const s = typeof val === 'string' ? val : (val.dateTime || val.date || '');
      if (!s) return '';
      const d = new Date(s.length === 10 ? `${s}T12:00:00` : s); // mitt på dagen om bara datum
      return isNaN(d) ? '' : format(d, 'HH:mm');
    };

    for (let w = 0; w < weeksToShow(); w++) {
      const weekNumber = getWeek(day, { weekStartsOn: 1 });
      cells.push(
        <div key={`week-${weekNumber}-${w}`} className="calendar-cell week-number">
          {weekNumber}
        </div>
      );

      for (let i = 0; i < 7; i++) {
        const date = addDays(day, i);
        const dateStr = format(date, 'yyyy-MM-dd');
        const today = ymdInTz(date) === todayStr;

        // Filtrera dagens event
        const eventsForDay = events.filter((ev) => ev.__instanceDate === dateStr);


        // Dela upp i skola24-lektioner (som vi grupperar) vs övrigt
        const grouped = {};
        const nonSchool = [];
        for (const ev of eventsForDay) {
          const maybeClass = getClassKey(ev);
          if (maybeClass || looksLikeSchoolLesson(ev.summary || '')) {
            const key = (maybeClass || 'SCHEMA').toUpperCase();
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(ev);
          } else {
            nonSchool.push(ev);
          }
        }

        // sortera lektioner i varje grupp efter starttid
        Object.keys(grouped).forEach((k) => {
          grouped[k].sort((a, b) => {
            const saSrc = a.start?.dateTime || a.start?.date || a.start;
            const sbSrc = b.start?.dateTime || b.start?.date || b.start;
            const sa = saSrc
              ? new Date(
                  typeof saSrc === 'string' && saSrc.length === 10 ? `${saSrc}T12:00:00` : saSrc
                ).getTime()
              : 0;
            const sb = sbSrc
              ? new Date(
                  typeof sbSrc === 'string' && sbSrc.length === 10 ? `${sbSrc}T12:00:00` : sbSrc
                ).getTime()
              : 0;
            return sa - sb;
          });
        });

        const baseDate = bedtimeBaseDate;
        const daysSince = Math.floor((date - baseDate) / (1000 * 60 * 60 * 24));
        const bedtime = bedtimeOverrides[dateStr] || (daysSince % 2 === 0 ? 'man' : 'woman');
        const weatherCode = weatherData[dateStr];
        const weatherIcon = weatherIcons[weatherCode];
        const dayInfo = dayInfoMap[dateStr] || {};

        const toggleExpand = (klassKey) => {
          const id = `${dateStr}|${klassKey}`;
          setExpandedGroups((m) => ({ ...m, [id]: !m[id] }));
        };
        const isExpanded = (klassKey) => !!expandedGroups[`${dateStr}|${klassKey}`];

        cells.push(
          <div
            key={dateStr}
            className={`calendar-cell ${today ? 'today' : ''} ${dayInfo.isRedDay ? 'red-day' : ''}`}
          >
            <div className="calendar-date">
              {format(date, 'd')}
              <span className="bedtime-icon" title="Växla läggning" onClick={() => toggleBedtime(dateStr)}>
                {bedtime === 'man' ? '👨‍🍼' : '👩‍🍼'}
              </span>
              <span className="weather-icon" title="Väder">
                {weatherIcon}
              </span>
              {dayInfo.isFlagDay && (
                <span className="flag-icon" title={dayInfo.flagReason}>
                  <img
                    src="/icons/se.svg"
                    alt="Flaggdag"
                    style={{ width: '1em', height: '1em', verticalAlign: 'middle' }}
                  />
                </span>
              )}
            </div>
            {dayInfo.holidayName && <div className="holiday-name">{dayInfo.holidayName}</div>}

            {/* 1) Sammanfattade klassgrupper (skolschema) */}
            {Object.keys(grouped)
              .sort((a, b) => {
                // lägg ev. "SCHEMA" sist, i övrigt alfabetiskt
                if (a === 'SCHEMA' && b !== 'SCHEMA') return 1;
                if (b === 'SCHEMA' && a !== 'SCHEMA') return -1;
                return a.localeCompare(b, 'sv');
              })
              .map((klassKey) => {
                const lessons = grouped[klassKey];
                const first = lessons[0];
                const last = lessons[lessons.length - 1];
                const anyIdrott = lessons.some((ev) => isIdrott(ev.summary));
                const label = getClassLabel(klassKey);
                const borderColor = colorFor(klassKey); // färg via schedule_config.colorRules

                return (
                  <div
                    key={`g-${klassKey}`}
                    className="event"
                    onClick={() => toggleExpand(klassKey)}
                    style={{
                      backgroundColor: '#6c63ff1a', // mild bakgrund
                      borderLeft: `4px solid ${borderColor}`,
                      cursor: 'pointer',
                    }}
                    title={`${label} (${lessons.length} lektioner) – klicka för att ${
                      isExpanded(klassKey) ? 'fälla in' : 'expandera'
                    }`}
                  >
                    <div className="event-meta">
                      <span className="event-time">
                        {timeStr(first.start)}–{timeStr(last.end || last.start)}
                      </span>
                      {anyIdrott && <span className="event-icon" style={{ marginLeft: 1 }}>🩳</span>}
                    </div>
                    <div className="event-title">
                      {label} ({lessons.length}) {isExpanded(klassKey) ? '▴' : '▾'}
                    </div>

                    {isExpanded(klassKey) && (
                      <div
                        className="lessons-compct"
                        style={{ marginTop: 6, fontSize: '0.85em', lineHeight: 1.25 }}
                      >
                        {lessons.map((ev, idx) => (
                          <div key={idx} className="lesson-row">
                            <div className="time">
                              {timeStr(ev.start)}
                              {ev.end ? '–' + timeStr(ev.end) : ''}
                            </div>
                            <div className="title">
                              <strong>{ev.summary}</strong>
                              {ev.location ? <span style={{ opacity: 0.7 }}> • {ev.location}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* 2) Övriga “vanliga” event */}
      {nonSchool.map((event, idx) => {
  const { icon, color } = getEventStyle(event.summary);
  const startStr = event.start?.dateTime || event.start?.date || event.start;
  const borderColor = colorFor(event.source); // t.ex. 'skola24', 'ics', 'birthday'
  const desc = event.description || '';
  const long = desc.length > MAX_DESC_CHARS;
  const expanded = isEventExpanded(event);
  const shownText = expanded ? desc : desc.slice(0, MAX_DESC_CHARS) + (long ? '…' : '');
  return (
    <div
    key={`e-${idx}`}
    className={`event ${isEventExpanded(event) ? 'expanded' : ''}`}
    style={{ backgroundColor: color, borderLeft: `4px solid ${borderColor}` }}
    title={event.source}
    onClick={(e) => {
      e.stopPropagation();
      toggleEventExpand(event);
    }}
  >
      <div className="event-meta">
        {!event.summary?.startsWith('🎂') && (
          <span className="event-time">{timeStr(startStr)}</span>
        )}
        {icon && <span className="event-icon">{icon}</span>}

        {event.location && (
          <button
            className="event-locbtn"
            title={event.location}
            onClick={(e) => {
              e.stopPropagation();
              setMapOverlay({
                open: true,
                title: event.summary || 'Plats',
                address: event.location,
                url: getMapsEmbedUrl(event.location),
                link: getMapsLink(event.location),
              });
            }}
            aria-label="Visa plats">📍</button>
        )}
      </div>

      <div className="event-title">{event.summary}</div>
      {desc && (
  <div className="event-desc">
    {shownText}
    {long && (
      <button
        className="event-expandbtn"
        onClick={(e) => { e.stopPropagation(); toggleEventExpand(event); }}
        aria-expanded={expanded}
      >
        {expanded ? 'Visa mindre' : 'Visa mer'}
      </button>
    )}
  </div>
)}
    </div>
  );
})}
</div>
);

}
      day = addDays(day, 7);
    }
    return cells;
  };

  // === Header helpers ===
  const periodStart = startOfWeek(currentStartDate, { weekStartsOn: 1 });
  const periodEnd = endOfWeek(addWeeks(periodStart, weeksToShow() - 1), { weekStartsOn: 1 });
  const headerLabel = isMaximized
    ? `${format(periodStart, 'd MMM yyyy', { locale: sv })} – ${format(periodEnd, 'd MMM yyyy', { locale: sv })} (hel månadsläge)`
    : `${format(periodStart, 'd MMM yyyy', { locale: sv })} – ${format(periodEnd, 'd MMM yyyy', { locale: sv })}`;
  const [presenceEnabled, setPresenceEnabled] = useState(false);

  const stepWeeks = weeksToShow();
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isDragging = useRef(false);
  const swipeHandled = useRef(false);

  const SWIPE_MIN_DISTANCE = 60; // px horisontellt
  const SWIPE_MAX_OFF_AXIS = 80; // px vertikalt tillåten avvikelse

  const goForward = () => setCurrentStartDate((d) => addWeeks(d, stepWeeks));
  const goBackward = () => setCurrentStartDate((d) => subWeeks(d, stepWeeks));

  // Touch
  const onTouchStart = (e) => {
    const t = e.touches[0];
    swipeStartX.current = t.clientX;
    swipeStartY.current = t.clientY;
    isDragging.current = true;
    swipeHandled.current = false;
  };
  const onTouchMove = (e) => {
    if (!isDragging.current || swipeHandled.current) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStartX.current;
    const dy = t.clientY - swipeStartY.current;
    if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS) return; // låt vertikal scroll vinna
    if (Math.abs(dx) >= SWIPE_MIN_DISTANCE) {
      swipeHandled.current = true;
      if (dx < 0) goForward();
      else goBackward();
    }
  };
  const onTouchEnd = () => {
    isDragging.current = false;
  };

  // Mus-drag (desktop)
  const onMouseDown = (e) => {
    swipeStartX.current = e.clientX;
    swipeStartY.current = e.clientY;
    isDragging.current = true;
    swipeHandled.current = false;
  };
  const onMouseMove = (e) => {
    if (!isDragging.current || swipeHandled.current) return;
    const dx = e.clientX - swipeStartX.current;
    const dy = e.clientY - swipeStartY.current;
    if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS) return;
    if (Math.abs(dx) >= SWIPE_MIN_DISTANCE) {
      swipeHandled.current = true;
      if (dx < 0) goForward();
      else goBackward();
    }
  };
  const onMouseUp = () => {
    isDragging.current = false;
  };

  // Piltangenter
  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') goBackward();
    if (e.key === 'ArrowRight') goForward();
  };

  const swipeBind = {
    onKeyDown,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    role: 'region',
    tabIndex: 0,
    'aria-label': 'Kalender, svep eller använd piltangenter för att byta veckor',
  };

  return (
    <div
      className={`calendar-container${isMaximized ? ' maximized' : ''}`}
      style={{
        ...(isMaximized
          ? { position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg, #fff)', padding: '8px' }
          : {}),
        touchAction: 'pan-y',
        userSelect: 'none',
        cursor: 'grab',
      }}
      {...swipeBind}
    >
      <div className="calendar-month-header">
        {/* Vänster del */}
        <div className="month-nav">
          <button onClick={() => setCurrentStartDate((d) => subWeeks(d, stepWeeks))}>{'‹'}</button>
          <button onClick={goToToday} title="Hoppa till idag" style={{ margin: '0 4px' }}>
            📅 Idag
          </button>
          <span className="month-label">{headerLabel}</span>
          <button onClick={() => setCurrentStartDate((d) => addWeeks(d, stepWeeks))}>{'›'}</button>
        </div>

        {/* Höger del */}
        <div className="month-actions">
          <HeaderClock className="wall-clock" />
          <div
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Byt till mörkt läge' : 'Byt till ljust läge'}
          >
            <animated.div className="theme-toggle__knob" style={knobSpring}>
              <span className="theme-toggle__icon">{theme === 'light' ? '☀️' : '🌙'}</span>
            </animated.div>
          </div>

          <button
            className="maximize-button"
            onClick={() => setIsMaximized((v) => !v)}
            title={isMaximized ? 'Avsluta helskärm' : 'Maximera till hel månad'}
            aria-pressed={isMaximized}
          >
            {isMaximized ? '⤡' : '⤢'}
          </button>

          <div className="menu-container" ref={menuRef}>
            <button className="menu-button" onClick={() => setShowMenu(!showMenu)}>
              <span className="menu-icon">⋯</span>
            </button>
            {showMenu && (
              <div className="menu-dropdown">
                <button
                  onClick={() => {
                    resetBedtimeOverrides();
                    setShowMenu(false);
                  }}
                >
                  Återställ turordning för läggning
                </button>
                <button
                  onClick={() => {
                    resetAllLocal();
                    setShowMenu(false);
                  }}
                >
                  Rensa alla lokala inställningar
                </button>
                <button
                  onClick={() => {
                    shiftBedtimeBaseDate(format(new Date(), 'yyyy-MM-dd'));
                    setShowMenu(false);
                  }}
                >
                  Starta ny turordning från idag
                </button>
                <button
                  onClick={() => {
                    refreshWeather();
                    setShowMenu(false);
                  }}
                >
                  Uppdatera väder
                </button>
                <button
                  onClick={() => {
                    reloadEverything();
                    setShowMenu(false);
                  }}
                >
                  Tvinga omladdning av kalenderdata
                </button>
                {!presenceEnabled && (
                  <button onClick={() => setPresenceEnabled(true)}>
                    Aktivera närvarosensor (kamera)
                  </button>
                )}
                <button
  onClick={() => { toggleBirthdayOverride(); setShowMenu(false); }}
>
  {birthdayOverride ? 'Stäng födelsedagsläge' : 'Starta födelsedagsläge (test)'}
</button>
                <button
  onClick={async () => {
    try {
      const mod = await import("canvas-confetti");
      const confetti = mod?.default ?? mod;
      confetti({ particleCount: 180, spread: 110, origin: { y: 0.55, x: 0.5 }, zIndex: 2147483647 });
    } catch (e) {
      console.error("Kunde inte ladda canvas-confetti", e);
      alert("Kunde inte ladda konfetti-modulen.");
    }
    setShowMenu(false);
  }}
>
  Testa konfetti nu
</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="calendar-grid">{[...renderDays(), ...renderCells()]}</div>
   {mapOverlay.open && (
  <div
    className="map-overlay"
    role="dialog"
    aria-modal="true"
    onClick={() => setMapOverlay({ open: false, title: '', url: '' })}
  >
    <div className="map-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="map-header">
        <div className="map-title">📍 {mapOverlay.title}</div>
        <button
          className="map-close"
          onClick={() => setMapOverlay({ open: false, title: '', url: '' })}
          aria-label="Stäng karta"
        >
          ✕
        </button>
      </div>
      <div className="map-body">
  <iframe
    src={mapOverlay.url}
    title="Karta"
    style={{ width: '100%', height: '100%', border: 0 }}
    referrerPolicy="no-referrer-when-downgrade"
  />
  <div className="map-side">
    <div className="qr-title">Öppna i mobilen</div>
    {mapOverlay.link ? (
  <QRCodeCanvas value={mapOverlay.link} size={220} includeMargin className="map-qr" />
) : (
  <div style={{opacity:.7, fontSize:'.9rem'}}>Ingen länk att koda</div>
)}
    <div className="qr-hint">Skanna för att få vägbeskrivning</div>
  </div>
</div>
    </div>
  </div>
)} 
   </div>
  );
}

export default CalendarGrid;
