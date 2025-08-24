const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const glob = require('fast-glob');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 4000;
const PICTURES_DIR = path.join(__dirname, 'pictures');

// Hjälp: hämta alla bildfiler en gång och cacha i minnet (uppdateras vid start)
let cachedList = [];
async function refreshList() {
  const patterns = [
    path.join(PICTURES_DIR, '**/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP}')
  ];
  const files = await glob(patterns, { absolute: true, onlyFiles: true, followSymbolicLinks: false });
  // Normalisera till web-vänliga namn via encodeURIComponent när vi bygger URLs i frontend
  cachedList = files.map(f => ({
    abs: f,
    rel: path.relative(PICTURES_DIR, f)
  }));
}
refreshList();

// Lista bilder
app.get('/api/pictures', async (req, res) => {
  try {
    if (!cachedList.length) await refreshList();
    const result = cachedList.map(x => x.rel);
    res.json({ count: result.length, items: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not list pictures' });
  }
});
let cachedMeta = null;
app.get("/api/pictures-meta", async (_req, res) => {
  try {
    if (!cachedList.length) await refreshList();
    if (!cachedMeta) {
      const out = [];
      for (const it of cachedList) {
        try {
          const m = await sharp(it.abs, { failOn: "none" }).metadata();
          const w = m.width || 0, h = m.height || 0;
          const orientation = w && h ? (h > w ? "portrait" : "landscape") : "unknown";
          out.push({ file: it.rel, orientation, width: w, height: h });
        } catch {
          out.push({ file: it.rel, orientation: "unknown" });
        }
      }
      cachedMeta = out;
    }
    res.json({ count: cachedMeta.length, items: cachedMeta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not build metadata" });
  }
});

app.get('/api/picture', async (req, res) => {
  try {
    const { file, w, h, q } = req.query;
    if (!file) return res.status(400).send('Missing file');

    const found = cachedList.find(x => x.rel === file);
    if (!found) return res.status(404).send('Not found');

    const width = Math.max(1, Math.min(4096, parseInt(w || '1080', 10)));
    const height = Math.max(1, Math.min(4096, parseInt(h || '1920', 10)));
    const quality = Math.max(1, Math.min(100, parseInt(q || '82', 10)));

    // Läser och auto-roterar, centrisk crop med "entropy"-fallback
    const stream = sharp(found.abs, { failOn: false })
      .rotate()
      .resize({ width, height, fit: 'cover', position: 'entropy', withoutEnlargement: false })
      .webp({ quality });

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/webp');
    stream.on('error', (err) => {
      console.error('Sharp error', err?.message);
      if (!res.headersSent) res.status(500).end('Image processing error');
    });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// Statisk hälsa
app.get('/api/slideshow/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Slideshow backend on :${PORT}`));