const express = require("express");
const axios = require("axios");
const router = express.Router();

const lat = 63.908577;
const lon = 20.56416;

// Cacha vädret i minnet i 1 dygn
let cachedData = null;
let cachedAt = null;

router.get("/", async (req, res) => {
  const now = new Date();
  if (cachedData && cachedAt && now - cachedAt < 24 * 60 * 60 * 1000) {
    return res.json(cachedData);
  }

  try {
    const url = `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${lon}/lat/${lat}/data.json`;
    const response = await axios.get(url);
    const timeSeries = response.data.timeSeries;

    const result = {};

    timeSeries.forEach((entry) => {
      const date = entry.validTime.split("T")[0];
      const weatherCode = entry.parameters.find(
        (p) => p.name === "Wsymb2"
      )?.values[0];
      if (weatherCode !== undefined && !result[date]) {
        result[date] = weatherCode;
      }
    });

    cachedData = result;
    cachedAt = new Date();
    res.json(result);
  } catch (error) {
    console.error("❌ Fel vid hämtning av väder från SMHI:", error.message);
    res.status(500).json({ error: "Kunde inte hämta väderdata" });
  }
});

// Aktuellt väder just nu
router.get("/now", async (req, res) => {
  try {
    const url = `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${lon}/lat/${lat}/data.json`;
    const response = await axios.get(url);
    const timeSeries = response.data.timeSeries;

    if (!timeSeries.length) {
      return res.status(503).json({ error: "No forecast" });
    }

    const nowIdx = timeSeries.findIndex(
      (it) => new Date(it.validTime) >= new Date()
    );
    const entry = timeSeries[Math.max(0, nowIdx)];
    const weatherCode = entry.parameters.find(
      (p) => p.name === "Wsymb2"
    )?.values[0];
    const temp = entry.parameters.find((p) => p.name === "t")?.values[0];

    return res.json({
      code: weatherCode,
      temp: Math.round(temp),
    });
  } catch (e) {
    console.error("weather/now error", e);
    res.status(500).json({ error: "weather now failed" });
  }
});

module.exports = router;
