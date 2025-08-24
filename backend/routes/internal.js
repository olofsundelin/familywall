// routes/internal.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getSchoolLunchCurrentWeek, isoWeekInfo } = require('../services/schoolLunch');

const router = express.Router();

router.post('/internal/run-nightly', async (req, res) => {
  try {
    // 1) Hämta skolmaten (uppdaterar cache)
    const { data: schoolMeals } = await getSchoolLunchCurrentWeek({ useCache: false });

    // 2) Läs matsedel.json, ersätt lunch vardagar i aktuell vecka, spara/skriv till DB om ni gör det här
    const localPath = path.join(__dirname, '../../frontend/src/matsedel.json');
    const matsedel = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const { week } = isoWeekInfo(new Date());
    const thisWeek = matsedel.weeks.find(w => Number(w.week) === Number(week));
    if (thisWeek) {
      thisWeek.days.forEach(day => {
        if (["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"].includes(day.day)) {
          day.lunch = schoolMeals[day.day] ?? null;
        }
      });
      // Ev. skriv tillbaka om ni vill persistenta ändringen i fil/Supabase:
      // fs.writeFileSync(localPath, JSON.stringify(matsedel, null, 2), 'utf8');
    }

    // 3) Kör vidare: generera middagar + inköpslista + bumpa wall_state (om ni har den biten)
    // await generateMealplanAndShopping({ week, lunches: schoolMeals });
    // await bumpWallStateVersion();

    res.json({ ok: true });
  } catch (e) {
    console.error('run-nightly error:', e);
    res.status(500).json({ ok: false, error: 'run_nightly_failed' });
  }
});

module.exports = router;
