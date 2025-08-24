const express = require('express');
const fs = require('fs');
const path = require('path');
// axios behövs inte här, kan tas bort
const { getSchoolLunchCurrentWeek, isoWeekInfo } = require('../services/schoolLunch');
const { bumpWallState, getWallState } = require('../services/wallState');

const router = express.Router();

let cachedMealplan = null;
let cachedAt = null;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 1 dygn

// Använd ISO-vecka istället för egen beräkning
function getCurrentISOWeek() {
  const { week } = isoWeekInfo(new Date());
  return week;
}

router.get('/', async (req, res) => {
  const now = new Date();
  console.log(`[Mealplan] Förfrågan mottagen ${now.toISOString()}`);

  if (cachedMealplan && cachedAt && now - cachedAt < CACHE_DURATION_MS) {
    console.log(`[Mealplan] Använder cache från ${cachedAt.toISOString()}`);
    return res.json(cachedMealplan);
  }

  try {
    console.log("[Mealplan] Läser matsedel.json och hämtar skolmat...");
    const localPath = path.join(__dirname, '../../frontend/src/matsedel.json');
    const matsedel = JSON.parse(fs.readFileSync(localPath, 'utf8'));

    const weekNumber = getCurrentISOWeek();
    const thisWeek = matsedel.weeks.find(w => Number(w.week) === Number(weekNumber));
    if (!thisWeek) return res.status(404).json({ error: 'Veckonummer saknas i matsedel.json' });

    const { data: schoolMeals } = await getSchoolLunchCurrentWeek({ useCache: true });

    thisWeek.days.forEach(day => {
      if (["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"].includes(day.day)) {
        day.lunch = schoolMeals[day.day] ?? null;
      }
    });

    cachedMealplan = thisWeek;
    cachedAt = now;
    console.log("[Mealplan] Cache uppdaterad.");
    res.json(thisWeek);
  } catch (err) {
    console.error('[Mealplan] Fel vid hämtning:', err);
    res.status(500).json({ error: 'Kunde inte hämta matsedel' });
  }
});

// End-point som returnerar skolmaten 
router.get('/school-lunch', async (req, res) => {
  const debug = req.query.debug === '1';
  try {
    const { week, weekYear, data } = await getSchoolLunchCurrentWeek({ useCache: true });

    // Bygg upp normaliserat svar för mån–fre. Fyll med "" om ingen data.
    const vardagar = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
    const dagar = vardagar.map(dag => ({
      dag,
      beskrivning: (data && data[dag]) ? data[dag] : ""
    }));

    if (debug) {
      console.log(`[SchoolLunch] v${week} ${weekYear} → ${JSON.stringify(data)}`);
    }
    
    res.json({ vecka: week, år: weekYear, dagar });
  } catch (err) {
    console.error('[Mealplan] Fel vid hämtning av skolmat:', err);

    // Fallback: returnera struktur med tomma fält så agenten kan fortsätta
    const { week, weekYear } = isoWeekInfo(new Date());
    const vardagar = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
    const dagar = vardagar.map(dag => ({ dag, beskrivning: "" }));

    res.status(200).json({
      vecka: week,
      år: weekYear,
      dagar,
      error: 'Kunde inte hämta skolmat (fallback utan data)'
    });
  }
});

module.exports = router;
