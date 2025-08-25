import os
import sys
import re
import json
import subprocess
from pathlib import Path
from typing import List, Dict, Optional

import requests
import datetime as dt
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
from routes.birthdays import birthdays_bp

try:
    from flask_cors import CORS
except Exception:  # CORS är valfritt
    CORS = None

from icalendar import Calendar
import recurring_ical_events
from dateutil.tz import gettz

from skola24_ics_blueprint import skola24_bp


# -------------------- App & Config --------------------

HERE = Path(__file__).resolve().parent
DATA_DIR = (HERE / "../data").resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
if CORS:
    CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGIN", "*")}})

TZ = gettz("Europe/Stockholm")
app.register_blueprint(skola24_bp, url_prefix="/api/skola24")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_KEY", "")
def _resolve_birthdays_path() -> Path:
    """
    Välj sökväg i denna ordning:
    1) Miljövariabel BIRTHDAYS_PATH (om satt)
    2) ../.secrets/birthdays.json (repo-root om backend/ ligger under)
    3) ./.secrets/birthdays.json (om du kör allt från samma mapp)
    """
    env_p = os.getenv("BIRTHDAYS_PATH")
    if env_p:
        return Path(env_p).expanduser().resolve()
    candidates = [
        (HERE / "../.secrets/birthdays.json").resolve(),
        (HERE / ".secrets/birthdays.json").resolve(),
        Path(".secrets/birthdays.json").resolve(),
    ]
    for p in candidates:
        if p.exists():
            return p
    # sista utvägen – peka mot default i repo-root
    return (HERE / "../.secrets/birthdays.json").resolve()

def _resolve_schedule_cfg_path() -> Path:
    env_p = os.getenv("SCHEDULE_CONFIG_PATH")
    if env_p:
        return Path(env_p).expanduser().resolve()
    for cand in [
        (HERE / "../.secrets/schedule_config.json"),
        (HERE / ".secrets/schedule_config.json"),
        Path(".secrets/schedule_config.json"),
    ]:
        if cand.exists():
            return cand.resolve()
    return (HERE / "../.secrets/schedule_config.json").resolve()
#//app.register_blueprint(skola24_bp, url_prefix="/skola24")

@app.route("/api/schedule-config", methods=["GET"])
def get_schedule_config():
    try:
        p = _resolve_schedule_cfg_path()
        data = {"colorRules": [], "classLabels": {}}
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                raw = json.load(f) or {}
            # sanera
            rules = []
            for r in raw.get("colorRules", []):
                inc = (r.get("includes") or "").strip()
                var = (r.get("colorVar") or "").strip() or "--default"
                if inc:
                    rules.append({"includes": inc, "colorVar": var})
            labels = {str(k): str(v) for k, v in (raw.get("classLabels") or {}).items()}
            data = {"colorRules": rules, "classLabels": labels}
        return jsonify(data)
    except Exception:
        app.logger.exception("Failed to read schedule_config")
        return jsonify({"colorRules": [], "classLabels": {}}), 200  # mjuk fallback

# --- Ny /api/birthdays-route (global app-variant) ---
@app.route("/api/birthdays", methods=["GET"])
def get_birthdays():
    """
    Returnerar {"birthdays": [{"date": "3/1", "name": "Mormor"}, ...]}
    Hämtar från .secrets/birthdays.json (konfigurerbar via BIRTHDAYS_PATH).
    """
    try:
        path = _resolve_birthdays_path()
        data = []
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f) or []
            # Sanera fält och ignorera konstiga poster
            for it in raw:
                date = (it.get("date") or "").strip()
                name = (it.get("name") or "").strip()
                if date and name:
                    data.append({"date": date, "name": name})
        return jsonify({"birthdays": data})
    except Exception as e:
        # logga gärna e till stderr om du vill
        return jsonify({"error": "internal error"}), 500

@app.route("/api/mealplan", methods=["GET"])
def mealplan_get():
    # ?vecka=34 (default: aktuell ISO-vecka i SE-tid)
    vecka = request.args.get("vecka")
    if not vecka:
        vecka = dt.datetime.now(gettz("Europe/Stockholm")).isocalendar()[1]
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return jsonify({"status":"fail","message":"SUPABASE_URL/ANON_KEY saknas i backend-env"}), 500
    url = f"{SUPABASE_URL}/rest/v1/mealplan?select=data&vecka=eq.{vecka}&order=created_at.desc&limit=1"
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"}
    r = requests.get(url, headers=headers, timeout=10)
    if r.status_code != 200:
        return jsonify({"status":"fail","message":f"Supabase {r.status_code}", "detail":r.text}), 502
    rows = r.json() if r.text else []
    return jsonify({"status":"ok","vecka": int(vecka),"data": (rows[0]["data"] if rows else None)})

# Cache-inställningar (enkelt minnescache)
CACHE_TTL = dt.timedelta(minutes=int(os.getenv("CACHE_TTL_MINUTES", "5")))
_cache_until: Optional[dt.datetime] = None
_cache_events: List[Dict] = []

# Fönster för vilka events vi expanderar i cachen
ICS_WINDOW_PAST_DAYS = int(os.getenv("ICS_WINDOW_PAST_DAYS", "30"))
ICS_WINDOW_FUTURE_DAYS = int(os.getenv("ICS_WINDOW_FUTURE_DAYS", "180"))

# -------------------- Helpers --------------------

def _json_now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def _parse_time_param(val: Optional[str], default: datetime) -> datetime:
    """
    Tål 'Z', '+HH:MM' och buggen där '+' blivit mellanslag i query (t.ex. '... 02:00').
    Returnerar tz-aware datetime.
    """
    if not val:
        return default
    v = val.strip()
    # "2025-08-21T08:22:09 02:00" -> "2025-08-21T08:22:09+02:00"
    v = re.sub(r'(\d{2}:\d{2}:\d{2}) (\d{2}:\d{2})$', r'\1+\2', v)
    if v.endswith('Z'):
        v = v[:-1] + '+00:00'
    return datetime.fromisoformat(v)

def _to_iso(x):
    """
    ISO8601 i Europe/Stockholm:
    - Heldag: 00:00 lokal tid den dagen (med korrekt offset).
    - Datetime: konverteras till Europe/Stockholm; naiva tider antas vara lokal tid.
    """
    if hasattr(x, "hour"):  # datetime
        if x.tzinfo is None:
            x = x.replace(tzinfo=TZ)
        return x.astimezone(TZ).isoformat()
    else:
        # date → 00:00 lokal tid
        dt_local = dt.datetime(x.year, x.month, x.day, 0, 0, 0, tzinfo=TZ)
        return dt_local.isoformat()

def _expand_ics(ics_bytes: bytes, win_start: dt.datetime, win_end: dt.datetime) -> List[Dict]:
    """
    Läser en ICS och expanderar återkommande händelser inom [win_start, win_end).
    """
    cal = Calendar.from_ical(ics_bytes)
    cal_name = str(cal.get('X-WR-CALNAME') or 'ICS')
    prodid = str(cal.get('prodid') or '').lower()
    src = 'skola24' if 'skola24' in (prodid + cal_name.lower()) else 'ics'

    items = recurring_ical_events.of(cal).between(win_start, win_end)

    out: List[Dict] = []
    for ev in items:
        start = ev.get('dtstart').dt
        end = (ev.get('dtend').dt if ev.get('dtend') else None)
        summary = str(ev.get('summary') or '')
        location = str(ev.get('location') or '')
        uid = str(ev.get('uid') or '')
        all_day = not hasattr(start, 'hour')

        out.append({
            "id": uid,
            "summary": summary,
            "location": location,
            "start": _to_iso(start),
            "end": (_to_iso(end) if end else None),
            "allDay": all_day,
            "source": src,
            "calendar": cal_name,
        })
    return out

def _refresh_events() -> List[Dict]:
    """
    Hämtar ICS_URLS, expanderar händelser i ett generöst fönster och deduplicerar.
    Mjuk-fail: om någon källa faller så fortsätter vi med resten.
    """
    urls = [u.strip() for u in os.getenv("ICS_URLS", "").split(",") if u.strip()]
    if not urls:
        return []

    now = dt.datetime.now(TZ)
    win_start = now - dt.timedelta(days=ICS_WINDOW_PAST_DAYS)
    win_end = now + dt.timedelta(days=ICS_WINDOW_FUTURE_DAYS)

    events: List[Dict] = []
    for url in urls:
        try:
            # Tillåt self-signed på din gateway om du skulle hämta där
            verify = True
            if url.startswith("https://192.168.50.230:3443"):
                verify = False
            r = requests.get(url, timeout=20, verify=verify)
            r.raise_for_status()
            events.extend(_expand_ics(r.content, win_start, win_end))
        except Exception as e:
            # logga tyst i stdout så vi ser i journalen men låter andra källor passera
            print(f"[ICS] WARN: kunde inte hämta {url}: {e}", file=sys.stderr)
            continue

    # sortera + enkel dedup (id, start) → behåll första
    events.sort(key=lambda e: (e.get("start") or "", e.get("summary") or ""))
    uniq: Dict[str, Dict] = {}
    for e in events:
        key = f"{e.get('id')}|{e.get('start')}"
        if key not in uniq:
            uniq[key] = e
    return list(uniq.values())

# -------------------- API-routes --------------------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "API lever", "ts": _json_now_utc()}), 200

def _read_status():
    p = DATA_DIR / "ai_status.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            return {"success": False, "message": f"Kunde inte läsa status: {e}", "timestamp": _json_now_utc()}
    return {"success": False, "message": "Ingen status tillgänglig ännu.", "timestamp": _json_now_utc()}

@app.route("/api/ai-status", methods=["GET"])
def ai_status():
    return jsonify(_read_status()), 200

@app.route("/api/planera", methods=["POST"])
def planera():
    """
    Kör ai_agent.py i en subprocess och returnerar stdout/stderr som JSON.
    """
    try:
        result = subprocess.run(
            [sys.executable, "ai_agent.py"],
            capture_output=True,
            text=True,
            env=os.environ.copy(),
            cwd=str(HERE),
            timeout=60 * 10  # 10 min
        )

        if result.returncode == 0:
            return jsonify({
                "status": "ok",
                "message": "Planeringen slutförd.",
                "stdout": (result.stdout or "").strip()
            }), 200

        return jsonify({
            "status": "fail",
            "message": "Kunde inte skapa matsedel.",
            "stderr": (result.stderr or "").strip(),
            "stdout": (result.stdout or "").strip()
        }), 500

    except subprocess.TimeoutExpired:
        return jsonify({"status": "fail", "message": "Planeringen tog för lång tid och avbröts (timeout)."}), 504
    except Exception as e:
        return jsonify({"status": "fail", "message": f"Undantag i /api/planera: {e.__class__.__name__}: {e}"}), 500

@app.route("/api/byt-middag", methods=["POST"])
def byt_middag():
    """
    Body: { "vecka": <int>, "dag": "<Måndag|...>" }
    """
    try:
        body = request.get_json(silent=True) or {}
        vecka = body.get("vecka")
        dag = body.get("dag") or body.get("dagNamn") or body.get("day_name")
        if vecka is None or not dag:
            return jsonify({"status": "fail", "message": "Saknar parameter: 'vecka' och/eller 'dag'."}), 400

        from ai_agent import generate_dinner_for_day  # lazy import
        new_dinner = generate_dinner_for_day(vecka=int(vecka), dagNamn=str(dag))

        return jsonify({"status": "ok", "vecka": vecka, "dag": dag, "newDinner": new_dinner}), 200

    except ImportError as ie:
        return jsonify({"status": "fail", "message": f"Importfel: {ie}"}), 500
    except Exception as e:
        return jsonify({"status": "fail", "message": f"Undantag i /api/byt-middag: {e}"}), 500

@app.route("/api/events", methods=["GET"])
def api_events():
    """
    Returnerar sammanfogade ICS-händelser (från ICS_URLS) filtrerade på timeMin/timeMax.
    """
    global _cache_until, _cache_events
    now = datetime.now(timezone.utc)

    # Ladda cache vid behov
    if _cache_until is None or now >= _cache_until:
        try:
            _cache_events = _refresh_events()
            _cache_until = now + CACHE_TTL
        except Exception as e:
            if not _cache_events:
                return jsonify({"status": "fail", "error": str(e)}), 502

    # Tolka fönster (default: ±180 dagar)
    time_min = _parse_time_param(request.args.get("timeMin"), now - timedelta(days=180))
    time_max = _parse_time_param(request.args.get("timeMax"), now + timedelta(days=180))

    def in_range(ev: Dict) -> bool:
        start_s = ev.get("start") or ev.get("startTime")
        if not start_s:
            return False
        s_txt = str(start_s)
        if s_txt.endswith('Z'):
            s_txt = s_txt[:-1] + '+00:00'
        try:
            s_dt = dt.datetime.fromisoformat(s_txt)
        except Exception:
            return False
        return (s_dt >= time_min) and (s_dt < time_max)

    out = [e for e in _cache_events if in_range(e)]
    # sortera snyggt på start
    out.sort(key=lambda e: e.get("start") or "")
    return jsonify(out)

@app.route("/api/events-ics", methods=["GET"])
def api_events_ics():
    # Alias för samma data, så fronten kan kalla /api/ai/events-ics om den vill
    return api_events()

# -------------------- Felhanterare --------------------

@app.errorhandler(Exception)
def _json_errors(e):
    if isinstance(e, HTTPException):
        return jsonify({"status": "fail", "error": e.name, "message": e.description}), e.code
    return jsonify({"status": "fail", "error": e.__class__.__name__, "message": str(e)}), 500

# -------------------- Main --------------------

if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", os.getenv("PORT", "5001")))
    app.run(host=host, port=port, debug=False)
