// services/schoolLunch.js
const Parser = require('rss-parser');
const parser = new Parser({
  defaultRSS: 2.0,
  timeout: 10000,
});

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 1 dygn
const cache = new Map(); // key: `${year}-${isoWeek}` -> { data, expiresAt }

function isoWeekInfo(d = new Date()) {
  // ISO-8601 vecka (Mån=1 … Sön=7)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() || 7);
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { weekYear: date.getUTCFullYear(), week: weekNo };
}

async function fetchSchoolLunchFromRSS() {
  const rssUrl = 'https://skolmaten.se/api/4/rss/week/savar-skola?locale=sv';
  const feed = await parser.parseURL(rssUrl);

  const items = Array.isArray(feed.items) ? feed.items : [];
  console.log(`[SchoolLunch] RSS items: ${items.length}`);
  if (items.length) {
    console.log(`[SchoolLunch] Exempel titel: "${items[0].title}"`);
  }

  const schoolMeals = {};
  // Matcha veckodag var som helst i titeln: "Måndag - Vecka 33", "Måndag 11/8", etc.
  const DAY_RE = /(Måndag|Tisdag|Onsdag|Torsdag|Fredag)/i;

  for (const item of items) {
    const title = (item.title || '').trim();
    const m = title.match(DAY_RE);
    if (!m) continue;

    const day = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(); // normalisera
    // rss-parser mappar <description> → item.content och item.contentSnippet
    const raw = (item.content || item.contentSnippet || '').trim();

    // Byt <br/> mot kommatecken, städa extra mellanslag
    const desc = raw
      .replace(/<br\s*\/?>/gi, ', ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();

    schoolMeals[day] = desc || '';
  }

  if (Object.keys(schoolMeals).length === 0) {
    console.warn('[SchoolLunch] Inga matchande dagar hittades i RSS (returnerar tom mapping).');
  }
  return schoolMeals;
}

async function getSchoolLunchCurrentWeek({ useCache = true } = {}) {
  const { weekYear, week } = isoWeekInfo(new Date());
  const key = `${weekYear}-${week}`;
  const now = Date.now();

  if (useCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return { weekYear, week, data: hit.data };
  }

  const data = await fetchSchoolLunchFromRSS();
  cache.set(key, { data, expiresAt: now + CACHE_DURATION_MS });
  return { weekYear, week, data };
}

module.exports = {
  getSchoolLunchCurrentWeek,
  isoWeekInfo,
};
