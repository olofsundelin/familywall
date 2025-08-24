require('dotenv').config();
const express = require('express');
const app = express(); // <-- initiera appen först
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const glob = require('fast-glob');
const https = require('https');
const http = require('http');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const HTTP_PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const AI_TARGET = process.env.AI_API_TARGET || 'http://host.docker.internal:5001';

function getHttpsOptions() {
  const certDir = path.join(__dirname, 'certs');

  const envCert = process.env.TLS_CERT_PATH && path.resolve(process.env.TLS_CERT_PATH);
  const envKey  = process.env.TLS_KEY_PATH  && path.resolve(process.env.TLS_KEY_PATH);
  if (envCert && envKey && fs.existsSync(envCert) && fs.existsSync(envKey)) {
    return { key: fs.readFileSync(envKey), cert: fs.readFileSync(envCert), source: `ENV (${envCert}, ${envKey})` };
  }

  const lanCert = path.join(certDir, 'lan.pem');
  const lanKey  = path.join(certDir, 'lan-key.pem');
  if (fs.existsSync(lanCert) && fs.existsSync(lanKey)) {
    return { key: fs.readFileSync(lanKey), cert: fs.readFileSync(lanCert), source: `certs/lan.pem + lan-key.pem` };
  }

  const localCert = path.join(certDir, 'localhost+3.pem');
  const localKey  = path.join(certDir, 'localhost+3-key.pem');
  if (fs.existsSync(localCert) && fs.existsSync(localKey)) {
    return { key: fs.readFileSync(localKey), cert: fs.readFileSync(localCert), source: `certs/localhost+3.pem + localhost+3-key.pem` };
  }

  return null;
}

console.log('🚀 STARTAR KODEN MED /api/photos SUPPORT');

// --- Proxy till Flask på värddatorn (utan extra npm-paket) ---
function proxyToFlask(base) {
  return (req, res) => {
    try {
      // Bevara sökväg + query, t.ex. /api/events-ics?timeMin=...
      const target = new URL(req.originalUrl, base); // base ex: 'http://192.168.50.230:5001'
      const options = {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
      };

      const p = http.request(options, (r) => {
        // vidarebefordra status & headers
        Object.keys(r.headers || {}).forEach((h) => {
          if (!['transfer-encoding', 'content-length', 'connection'].includes(h.toLowerCase())) {
            res.setHeader(h, r.headers[h]);
          }
        });
        res.statusCode = r.statusCode || 502;
        r.pipe(res);
      });

      p.on('error', (err) => {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
      });

      req.pipe(p);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'proxy_exception', message: String(e) }));
    }
  };
}

// Nya vägar: proxya till Flask (värddatorn)
// NOTE: vi använder värddatorns IP direkt så vi slipper specialfalla host.docker.internal
app.use('/api/events-ics', proxyToFlask('http://192.168.50.230:5001'));
app.use('/api/health',     proxyToFlask('http://192.168.50.230:5001'));

/* =========================
   CORS + Private Network Access
   ========================= */
const allowlist = new Set([
  'http://192.168.50.230',
  'http://192.168.50.230:80',
  'http://localhost',
  'http://localhost:80',
  'https://192.168.50.230',
  'https://192.168.50.230:3443',
]);

const corsOptionsDelegate = (req, cb) => {
  const origin = req.header('Origin');
  const corsOptions = {
    origin: !!origin && allowlist.has(origin),
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  cb(null, corsOptions);
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(cors(corsOptionsDelegate));
app.options(/.*/, cors(corsOptionsDelegate));

/* =========================
   Debug
   ========================= */
app.get('/debug', (_req, res) => res.send('🔧 Debug-route aktiv'));

/* =========================
   Bilder
   ========================= */
const PICTURES_DIR = path.join(__dirname, 'pictures');

let cachedList = [];
async function refreshList() {
  const patterns = [path.join(PICTURES_DIR, '**/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP}')];
  const files = await glob(patterns, { absolute: true, onlyFiles: true, followSymbolicLinks: false });
  cachedList = files.map(f => ({ abs: f, rel: path.relative(PICTURES_DIR, f) }));
}
refreshList();

app.get('/api/pictures', async (_req, res) => {
  try {
    if (!cachedList.length) await refreshList();
    res.json({ count: cachedList.length, items: cachedList.map(x => x.rel) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not list pictures' });
  }
});

let cachedMeta = null;
app.get('/api/pictures-meta', async (_req, res) => {
  try {
    if (!cachedList.length) await refreshList();
    if (!cachedMeta) {
      const out = [];
      for (const it of cachedList) {
        try {
          const m = await sharp(it.abs, { failOn: 'none' }).metadata();
          const w = m.width || 0, h = m.height || 0;
          const orientation = w && h ? (h > w ? 'portrait' : 'landscape') : 'unknown';
          out.push({ file: it.rel, orientation, width: w, height: h });
        } catch {
          out.push({ file: it.rel, orientation: 'unknown' });
        }
      }
      cachedMeta = out;
    }
    res.json({ count: cachedMeta.length, items: cachedMeta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not build metadata' });
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

    const stream = sharp(found.abs, { failOn: 'none' })
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

// Health för slideshow/backend
app.get('/api/slideshow/health', (_req, res) => res.json({ ok: true }));

/* =========================
   Övriga API-routes
   ========================= */
const weatherRoute = require('./routes/weather');
const mealplanRoute = require('./routes/mealplan');
const eventsRoute = require('./routes/events');

app.use('/api/weather', weatherRoute);
app.use('/api/mealplan', mealplanRoute);
app.use('/api/events', eventsRoute);

/* =========================
   AI-proxy (robust rewrite)
   =========================
   Viktigt: eftersom Express monterar på '/api/ai' så STRIPPAS prefixet.
   Dvs req.url här inne är '/health', '/planera', '/byt-middag', etc.
   Vi lägger därför TILL '/api' så Flask får '/api/health' osv. */
app.use(
  '/api/ai',
  createProxyMiddleware({
    target: AI_TARGET,                 // Flask kör HTTP på 5001
    changeOrigin: true,
    // 🔑 det här är själva fixen: /api/ai/... -> /api/...
    pathRewrite: (path) => {
      const newPath = path.startsWith('/api/') ? path : `/api${path}`;
      console.log('[AI-REWRITE]', path, '->', newPath);
      return newPath;
    },
    logLevel: 'debug',
    proxyTimeout: 10 * 60 * 1000,
    timeout: 10 * 60 * 1000,
    onProxyReq(proxyReq, req) {
      // Logga vad som faktiskt går vidare till Flask
      console.log('[AI-PROXY]', req.method, req.originalUrl, '->', proxyReq.path);
    },
    onError(err, req, res) {
      console.error('[AI-PROXY ERROR]', err.code || err.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'fail',
        message: 'AI-upstream fel (kunde inte nå planera_api)',
        code: err.code || 'PROXY_ERROR',
      }));
    },
  })
);

/* =========================
   Frontend-proxy (catch-all)
   ========================= */
const frontendProxy = createProxyMiddleware({
  target: process.env.FRONTEND_TARGET || 'http://frontend:80',
  changeOrigin: true,
  logLevel: 'warn',
});

// Alla icke-API paths → frontend
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return frontendProxy(req, res, next);
});

/* =========================
   Static frontend (om build finns lokalt)
   ========================= */
const buildPath = path.resolve(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(buildPath, 'index.html'));
  });
} else {
  console.warn('⚠️  Build-folder saknas – frontend static routes är inaktiva');
}

/* =========================
   Starta servrar
   ========================= */
const httpsOptions = getHttpsOptions();

if (httpsOptions) {
  https.createServer({ key: httpsOptions.key, cert: httpsOptions.cert }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`✅ HTTPS lyssnar på https://0.0.0.0:${HTTPS_PORT} (${httpsOptions.source})`);
    });

  http.createServer((req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    const redirectURL = `https://${host}:${HTTPS_PORT}${req.url}`;
    res.writeHead(301, { Location: redirectURL });
    res.end();
  }).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`↪️  HTTP :${HTTP_PORT} → redirect till :${HTTPS_PORT}`);
  });
} else {
  http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`✅ HTTP lyssnar på http://0.0.0.0:${HTTP_PORT} (inget TLS-cert hittades)`);
  });
}
