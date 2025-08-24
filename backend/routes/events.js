const express = require('express');
const router = express.Router();
const axios = require('axios');
const ical = require('ical');

// === Konfiguration via .env eller docker-compose ===
const HOME_ASSISTANT_URL = process.env.HOME_ASSISTANT_URL;
const HOME_ASSISTANT_TOKEN = process.env.HOME_ASSISTANT_TOKEN;

// === 1. Hämta händelser från Home Assistant-kalender ===
async function fetchHAEvents(entityId, start, end) {
  const url = `${HOME_ASSISTANT_URL}/api/calendars/${entityId}?start=${start}&end=${end}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  return res.data.map((ev) => ({
    summary: ev.summary,
    start: ev.start,
    end: ev.end,
    location: ev.location || '',
    source: 'Google via HA',
    calendar: 'Familjekalender',
  }));
}

// === 2. Generisk ICS-hämtare (Skola24/andra ICS) ===
async function fetchICS(url, label, startWindowISO, endWindowISO) {
  const res = await axios.get(url, { responseType: 'text' });
  const data = ical.parseICS(res.data);
  const events = [];
  const startWindow = new Date(startWindowISO);
  const endWindow = new Date(endWindowISO);

  for (const k in data) {
    const ev = data[k];
    if (ev && ev.type === 'VEVENT') {
      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      // Filtrera mot tidsfönstret vi ändå exponerar
      if (start >= startWindow && start <= endWindow) {
        events.push({
          summary: ev.summary,
          start,
          end,
          location: ev.location || '',
          source: label,        // t.ex. "Skola24: Ida" / "Skola24: Max"
          calendar: label,
          uid: ev.uid || undefined,
          allDay: !!ev.datetype  // vissa ICS flaggar detta; harmless om undefined
        });
      }
    }
  }

  return events;
}

// === 3. API: GET /api/events ===
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const weekAhead = new Date();
    weekAhead.setDate(now.getDate() + 28);

    const startISO = now.toISOString();
    const endISO = weekAhead.toISOString();

    console.log('⏳ Hämtar kalenderdata...');
    console.log('Start:', startISO);
    console.log('End:  ', endISO);

    const results = await Promise.allSettled([
      fetchHAEvents('calendar.familjekalender', startISO, endISO),
      // Dotterns schema (befintligt)
      fetchICS(`${HOME_ASSISTANT_URL}/config/schedule.ics`, 'Skola24: Ida', startISO, endISO),
      // Sonens schema (NYTT)
      fetchICS(`${HOME_ASSISTANT_URL}/config/max.ics`, 'Skola24: Max', startISO, endISO),
    ]);

    const [googleRes, idaRes, maxRes] = results;
    const googleEvents = googleRes.status === 'fulfilled' ? googleRes.value : [];
    const idaEvents = idaRes.status === 'fulfilled' ? idaRes.value : [];
    const maxEvents = maxRes.status === 'fulfilled' ? maxRes.value : [];

    if (googleRes.status === 'rejected') console.warn('⚠️ Google/HA misslyckades:', googleRes.reason?.message);
    if (idaRes.status === 'rejected') console.warn('⚠️ Ida ICS misslyckades:', idaRes.reason?.message);
    if (maxRes.status === 'rejected') console.warn('⚠️ Max ICS misslyckades:', maxRes.reason?.message);

    console.log(`✅ Google-kalender: ${googleEvents.length} händelser`);
    console.log(`✅ Skola24: Ida: ${idaEvents.length} händelser`);
    console.log(`✅ Skola24: Max: ${maxEvents.length} händelser`);

    const allEvents = [...googleEvents, ...idaEvents, ...maxEvents].sort(
      (a, b) => new Date(a.start) - new Date(b.start)
    );

    res.json(allEvents);
  } catch (err) {
    console.error('❌ Fel vid hämtning av kalenderdata:', err.message);
    res.status(500).json({
      error: 'Kunde inte hämta kalenderdata',
      details: err.message,
    });
  }
});

module.exports = router;
