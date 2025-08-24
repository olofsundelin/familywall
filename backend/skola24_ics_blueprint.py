# skola24_ics_blueprint.py
# Mount in your existing Flask app:
#   from skola24_ics_blueprint import skola24_bp
#   app.register_blueprint(skola24_bp, url_prefix="/skola24")
# Endpoints:
#   GET /skola24/ics/<klass>       (e.g., /skola24/ics/Class_A
#   GET /skola24/units             (lists units)
#   GET /skola24/units/debug       (raw debug for unit listing)
#   GET /skola24/schoolyears/debug (raw debug for school year)
#   GET /skola24/                  (service info)

from __future__ import annotations

import os
import time as _time
from typing import Any, Dict, List, Tuple
from datetime import datetime, date, time as dtime, timedelta

# Optional .env auto-load (safe fallback if package missing)
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass

import requests
from flask import Blueprint, Response, jsonify, request, abort
from zoneinfo import ZoneInfo

# -------------------- Config --------------------
BASE = "https://web.skola24.se"
HOST = os.getenv("SKOLA24_HOST", "example.skola24.se")
SCHOOL_NAME = os.getenv("SKOLA24_SCHOOL", "Example school")
DEFAULT_CLASSES = [c.strip() for c in os.getenv("SKOLA24_CLASSES", "A,B").split(",") if c.strip()]
X_SCOPE = os.getenv("SKOLA24_X_SCOPE", "8a22163c-8662-4535-9050-bc5e1923df48")

# Visible window defaults (current week + 3 ahead ≈ 4 weeks total)
DEFAULT_WEEKS_BACK = int(os.getenv("DEFAULT_WEEKS_BACK", "0"))
DEFAULT_WEEKS_AHEAD = int(os.getenv("DEFAULT_WEEKS_AHEAD", "3"))

# Cache TTL per (class, week, year) render
CACHE_TTL = int(os.getenv("CACHE_TTL", str(24 * 3600)))  # 24h

TZ_LOCAL = ZoneInfo("Europe/Stockholm")
TZ_UTC = ZoneInfo("UTC")

# Skola24 endpoints
URL_ENCRYPT = f"{BASE}/api/encrypt/signature"
URL_RENDER_KEY = f"{BASE}/api/get/timetable/render/key"
URL_UNITS_A = f"{BASE}/api/services/skola24/get/timetable/viewer/units"
URL_UNITS_B = f"{BASE}/api/get/timetable/viewer/units"
URL_SCHOOL_YEARS_A = f"{BASE}/api/services/skola24/get/active/school/years"
URL_SCHOOL_YEARS_B = f"{BASE}/api/get/active/school/years"
URL_RENDER = f"{BASE}/api/render/timetable"

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "sv-SE,sv;q=0.8,en-US;q=0.5,en;q=0.3",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-Scope": X_SCOPE,
    "Origin": BASE,
    "Referer": f"{BASE}/portal/start/timetable/timetable-viewer/{HOST}/",
    "Cache-Control": "no-cache",
}

skola24_bp = Blueprint("skola24", __name__)

# -------------------- HTTP session + warmup --------------------
sess = requests.Session()
def get_active_school_year_guid() -> str:
    """
    Matchar HA: /api/get/active/school/years → ta första GUID.
    """
    body = {
        "hostName": HOST,
        "checkSchoolYearsFeatures": "false"
    }
    r = sess.post("https://web.skola24.se/api/get/active/school/years", json=body, headers=COMMON_HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    sy = (((data or {}).get("data") or {}).get("activeSchoolYears") or [])
    if not sy:
        raise RuntimeError("Skola24: kunde inte hitta activeSchoolYears")
    return sy[0]["guid"]  # GUID, inte siffra


def get_class_guid(klass: str, unit_guid: str) -> str:
    """
    Matchar HA: /api/get/timetable/selection → hämta groupGuid för klass.
    """
    body = {
        "hostname": HOST,
        "unitGuid": unit_guid,
        "filters": { "class": "true" }
    }
    r = sess.post("https://web.skola24.se/api/get/timetable/selection", json=body, headers=COMMON_HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    classes = (((data or {}).get("data") or {}).get("classes") or [])
    # enkel normalisering
    want = klass.strip().lower()
    for c in classes:
        if str(c.get("groupName","")).strip().lower() == want:
            return c["groupGuid"]
    raise RuntimeError(f"Skola24: kunde inte matcha klass '{klass}'. Tillgängligt: {[c.get('groupName') for c in classes]}")

def warmup_session() -> None:
    url = f"{BASE}/portal/start/timetable/timetable-viewer/{HOST}/"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
    }
    try:
        sess.get(url, headers=headers, timeout=30)
    except Exception:
        pass

warmup_session()

# -------------------- Simple cache --------------------
class _Cache:
    def __init__(self) -> None:
        self._data: Dict[Tuple, Tuple[float, Any]] = {}

    def get(self, key: Tuple) -> Any:
        item = self._data.get(key)
        if not item:
            return None
        expires_at, value = item
        if _time.time() > expires_at:
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: Tuple, value: Any, ttl: int = CACHE_TTL) -> None:
        self._data[key] = (_time.time() + ttl, value)

cache = _Cache()

# -------------------- HTTP helper --------------------

def _post(url: str, json_body: Any) -> dict:
    r = sess.post(url, json=json_body, headers=COMMON_HEADERS, timeout=30)
    if not r.ok:
        abort(r.status_code, description=f"Skola24 fel {r.status_code} vid POST {url}")
    try:
        return r.json()
    except Exception as e:
        abort(502, description=f"Kunde inte tolka JSON från {url}: {e}")

# -------------------- Skola24 helpers --------------------

def encrypt_signature(text: str) -> str:
    data = _post(URL_ENCRYPT, {"signature": text})
    return data["data"]["signature"]


def get_render_key() -> str:
    data = _post(URL_RENDER_KEY, {})
    return data["data"]["key"]


def _norm(s: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", s or "").casefold()


def _extract_units(data: dict) -> List[dict]:
    """Handle both response shapes:
    A) data.getTimetableViewerUnitsResponse.units
    B) data.units
    and unitName may be null; unitId contains readable name.
    """
    d = data.get("data") or {}
    g = d.get("getTimetableViewerUnitsResponse") or {}
    units = g.get("units") or []
    if units:
        return units
    units = d.get("units") or []
    return units


def _extract_active_school_year(data: dict) -> int | None:
    d = data.get("data") or {}
    year = d.get("activeSchoolYear")
    if year:
        return int(year)
    g = d.get("getActiveSchoolYearsResponse") or {}
    year = g.get("activeSchoolYear")
    if year:
        return int(year)
    years = g.get("schoolYears") or []
    try:
        active = next((y for y in years if y.get("isActive")), None)
        if active and active.get("schoolYear"):
            return int(active.get("schoolYear"))
        vals = [int(y.get("schoolYear")) for y in years if y.get("schoolYear")]
        return max(vals) if vals else None
    except Exception:
        return None


def get_unit_guid() -> str:
    ck = ("unit_guid", HOST, SCHOOL_NAME)
    cached = cache.get(ck)
    if cached:
        return cached

    env_guid = os.getenv("SKOLA24_UNIT_GUID")
    if env_guid:
        cache.set(ck, env_guid)
        return env_guid

    units: List[dict] = []
    # Prefer services URL with wrapped body
    try:
        data = _post(URL_UNITS_A, {"getTimetableViewerUnitsRequest": {"hostName": HOST}})
        units = _extract_units(data)
    except Exception:
        units = []

    if not units:
        for url in (URL_UNITS_A, URL_UNITS_B):
            for body in ({"hostName": HOST}, {}):
                try:
                    data = _post(url, body)
                    part = _extract_units(data)
                    if part:
                        units = part
                        break
                except Exception:
                    continue
            if units:
                break

    if not units:
        abort(502, description="Kunde inte hämta enheter från Skola24. Kontrollera HOST eller sätt SKOLA24_UNIT_GUID.")

    wanted = _norm(SCHOOL_NAME)
    for u in units:
        name = (u.get("unitName") or u.get("unitId") or "").strip()
        if _norm(name) == wanted:
            guid = u.get("unitGuid")
            if guid:
                cache.set(ck, guid)
                return guid
    for u in units:
        name = (u.get("unitName") or u.get("unitId") or "").strip()
        if wanted in _norm(name):
            guid = u.get("unitGuid")
            if guid:
                cache.set(ck, guid)
                return guid

    names = ", ".join(sorted({(u.get("unitName") or u.get("unitId") or "").strip() for u in units}))
    abort(404, description=f"Skolenhet '{SCHOOL_NAME}' hittades inte på host '{HOST}'. Tillgängliga enheter: {names or '(tom)'}")


def get_active_school_year() -> int:
    ck = ("school_year", HOST)
    cached = cache.get(ck)
    if cached:
        return cached

    attempts = [
        (URL_SCHOOL_YEARS_A, {"getActiveSchoolYearsRequest": {"hostName": HOST, "unitGuid": os.getenv("SKOLA24_UNIT_GUID")}}),
        (URL_SCHOOL_YEARS_A, {"getActiveSchoolYearsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_A, {"getTimetableViewerUnitsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_A, {"hostName": HOST}),
        (URL_SCHOOL_YEARS_A, {}),
        (URL_SCHOOL_YEARS_B, {"getActiveSchoolYearsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_B, {"getTimetableViewerUnitsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_B, {"hostName": HOST}),
        (URL_SCHOOL_YEARS_B, {}),
    ]

    year: int | None = None
    for url, body in attempts:
        try:
            data = _post(url, body)
            year = _extract_active_school_year(data)
            if year:
                break
        except Exception:
            continue

    if not year:
        today = date.today()
        year = today.year if today.month >= 7 else today.year - 1

    if not year:
        abort(500, description="Kunde inte läsa aktivt läsår från Skola24.")

    cache.set(ck, year)
    return year


def render_week(klass: str, iso_year: int, school_year: int | str, week: int, unit_guid: str, class_guid: str | None = None) -> list[dict]:
    ck = ("render", HOST, klass, iso_year, week, str(school_year), unit_guid, class_guid or "")
    cached = cache.get(ck)
    if cached is not None:
        return cached

    rk = get_render_key()

    # 1) Första prio: explicit class_guid (query-param eller klass-specifik env)
    # 2) Andra prio: global SKOLA24_CLASS_GUID (bakåtkompatibelt)
    # 3) Annars: signatur på klassnamn (selectionType 4)
    cg = (class_guid or "").strip() or os.getenv(f"SKOLA24_CLASS_GUID_{klass}", "").strip()
    if not cg:
        cg = os.getenv("SKOLA24_CLASS_GUID", "").strip()

    if cg:
        selection = cg
        selection_type = 0
    else:
        selection = encrypt_signature(klass)
        selection_type = 4

    body = {
        "blackAndWhite": False,
        "customerKey": "",
        "endDate": None,
        "height": 550,
        "host": HOST,
        "periodText": "",
        "privateFreeTextMode": False,
        "privateSelectionMode": None,
        "renderKey": rk,
        "scheduleDay": 0,
        "schoolYear": school_year,
        "selection": selection,
        "selectionType": selection_type,
        "showHeader": False,
        "startDate": None,
        "unitGuid": unit_guid,
        "week": week,
        "width": 1200,
        "year": iso_year,
    }
    data = _post(URL_RENDER, body)
    lessons = (data.get("data") or {}).get("lessonInfo") or []
    cache.set(ck, lessons)
    return lessons



# -------------------- Date & ICS helpers --------------------

def iso_week_of(d: date) -> Tuple[int, int]:
    isoyear, week, _ = d.isocalendar()
    return isoyear, week


def weeks_range(today: date, weeks_back: int, weeks_ahead: int) -> List[Tuple[int, int]]:
    monday = today - timedelta(days=today.weekday())
    start_anchor = monday - timedelta(weeks=weeks_back)
    end_anchor = monday + timedelta(weeks=weeks_ahead)
    pairs: List[Tuple[int, int]] = []
    cur = start_anchor
    while cur <= end_anchor:
        y, w = iso_week_of(cur)
        if (y, w) not in pairs:
            pairs.append((y, w))
        cur += timedelta(weeks=1)
    return pairs


def local_time_to_utc(dt_date: date, hhmm: str) -> str:
    """
    Tar emot 'HH:MM' eller 'HH:MM:SS' och returnerar UTC i ICS-format (Z).
    """
    if not hhmm:
        raise ValueError("Empty time string")
    parts = hhmm.strip().split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) >= 2 else 0
        s = int(parts[2]) if len(parts) >= 3 else 0
    except Exception as e:
        raise ValueError(f"Bad time '{hhmm}': {e}")
    local_dt = datetime.combine(dt_date, dtime(hour=h, minute=m, second=s), tzinfo=TZ_LOCAL)
    utc_dt = local_dt.astimezone(TZ_UTC)
    return utc_dt.strftime("%Y%m%dT%H%M%SZ")


def fold_lesson_texts(texts: List[str]) -> Tuple[str, str, str]:
    if not texts:
        return ("Gråtid", "", "Gråtid")
    subject = texts[0] if len(texts) > 0 else ""
    room = texts[2] if len(texts) > 2 else ""
    desc = " ".join(t.strip() for t in texts if t and t.strip())
    return subject, room, (desc or subject)


def build_ics(klass: str, lessons_by_day: Dict[date, List[dict]]) -> str:
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//family-wall//skola24-ics//EN",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{klass} ({SCHOOL_NAME})",
        "X-WR-TIMEZONE:Europe/Stockholm",
    ]
    for d, lessons in lessons_by_day.items():
        for item in lessons:
            start = item.get("timeStart")
            end = item.get("timeEnd")
            if not start or not end:
                continue
            guid = item.get("guidId") or f"{klass}-{d.isoformat()}-{start}"
            subject, room, desc = fold_lesson_texts(item.get("texts") or [])
            summary = f"{klass} {subject}"
            lines += [
                "BEGIN:VEVENT",
                f"DTSTAMP:{dtstamp}",
                f"UID:{guid}-{d.strftime('%Y%m%d')}",
                f"SUMMARY:{summary}",
                f"DTSTART:{local_time_to_utc(d, start)}",
                f"DTEND:{local_time_to_utc(d, end)}",
            ]
            if room:
                lines.append(f"LOCATION:{room}")
            lines.append(f"DESCRIPTION:{desc}")
            if subject == "Gråtid":
                lines.append("TRANSP:TRANSPARENT")
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)

# -------------------- Routes --------------------
@skola24_bp.route("/ics/<klass>", methods=["GET"], strict_slashes=False)
def ics_for_class(klass: str):
    klass = (klass or "").strip()
    if not klass:
        abort(400, description="Ange klass")

    try:
        weeks_back = int(request.args.get("weeks_back", DEFAULT_WEEKS_BACK))
        weeks_ahead = int(request.args.get("weeks_ahead", DEFAULT_WEEKS_AHEAD))
    except ValueError:
        abort(400, description="weeks_back/weeks_ahead måste vara heltal")

    # NYTT: class_guid via query eller klass-specifik env som fallback
    class_guid = (request.args.get("class_guid") or
                  os.getenv(f"SKOLA24_CLASS_GUID_{klass}", "").strip() or
                  None)

    today = date.today()
    pairs = weeks_range(today, weeks_back, weeks_ahead)

    unit_guid = get_unit_guid()
    school_year = os.getenv("SKOLA24_SCHOOL_YEAR_GUID") or get_active_school_year_guid()

    all_lessons = {}
    for (iso_year, w) in pairs:
        all_lessons[(iso_year, w)] = render_week(
            klass, iso_year, school_year, w, unit_guid, class_guid=class_guid
        )

    lessons_by_day: Dict[date, List[dict]] = {}
    for (y, w), lessons in all_lessons.items():
        for weekday in range(1, 6):
            d = date.fromisocalendar(y, w, weekday)
            day_items = [li for li in lessons if li.get("dayOfWeekNumber") == weekday]
            if day_items:
                lessons_by_day.setdefault(d, []).extend(day_items)

    ics = build_ics(klass, dict(sorted(lessons_by_day.items())))

    headers = {
        "Content-Disposition": f'attachment; filename="{klass}.ics"',
        "Cache-Control": "public, max-age=600",
    }
    return Response(ics, mimetype="text/calendar; charset=utf-8", headers=headers)


@skola24_bp.route("/units", methods=["GET"], strict_slashes=False)
def list_units():
    units: List[dict] = []
    problems: List[dict] = []
    try:
        data = _post(URL_UNITS_A, {"getTimetableViewerUnitsRequest": {"hostName": HOST}})
        units = _extract_units(data)
    except Exception as e:
        problems.append({"url": URL_UNITS_A, "body": {"getTimetableViewerUnitsRequest": {"hostName": HOST}}, "error": str(e)})

    if not units:
        for url in (URL_UNITS_A, URL_UNITS_B):
            for body in ({"hostName": HOST}, {}):
                try:
                    data = _post(url, body)
                    part = _extract_units(data)
                    if part:
                        units = part
                        break
                except Exception as e:
                    problems.append({"url": url, "body": body, "error": str(e)})
            if units:
                break

    return jsonify({
        "host": HOST,
        "school": SCHOOL_NAME,
        "units": [{
            "unitGuid": u.get("unitGuid"),
            "unitName": (u.get("unitName") or u.get("unitId") or "").strip()
        } for u in units],
        "problems": problems,
        "hint": "Om listan är tom, sätt SKOLA24_UNIT_GUID eller kontrollera HOST",
    })


@skola24_bp.route("/units/debug", methods=["GET"], strict_slashes=False)
def units_debug():
    attempts: List[dict] = []
    for url in (URL_UNITS_A, URL_UNITS_B):
        for body in (
            {"getTimetableViewerUnitsRequest": {"hostName": HOST}},
            {"hostName": HOST},
            {},
        ):
            try:
                r = sess.post(url, json=body, headers=COMMON_HEADERS, timeout=30)
                try:
                    data = r.json()
                    snippet = str(data)[:300]
                except Exception:
                    data = None
                    snippet = r.text[:300]
                attempts.append({
                    "url": url,
                    "body": body,
                    "status": r.status_code,
                    "ok": r.ok,
                    "snippet": snippet,
                })
            except Exception as e:
                attempts.append({"url": url, "body": body, "error": str(e)})
    return jsonify({
        "host": HOST,
        "attempts": attempts,
    })


@skola24_bp.route("/schoolyears/debug", methods=["GET"], strict_slashes=False)
def schoolyears_debug():
    attempts: List[dict] = []
    for url, body in (
        (URL_SCHOOL_YEARS_A, {"getActiveSchoolYearsRequest": {"hostName": HOST, "unitGuid": os.getenv("SKOLA24_UNIT_GUID")}}),
        (URL_SCHOOL_YEARS_A, {"getActiveSchoolYearsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_A, {"getTimetableViewerUnitsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_A, {"hostName": HOST}),
        (URL_SCHOOL_YEARS_A, {}),
        (URL_SCHOOL_YEARS_B, {"getActiveSchoolYearsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_B, {"getTimetableViewerUnitsRequest": {"hostName": HOST}}),
        (URL_SCHOOL_YEARS_B, {"hostName": HOST}),
        (URL_SCHOOL_YEARS_B, {}),
    ):
        try:
            r = sess.post(url, json=body, headers=COMMON_HEADERS, timeout=30)
            try:
                data = r.json()
            except Exception:
                data = {"_raw": r.text[:300]}
            attempts.append({
                "url": url,
                "body": body,
                "status": r.status_code,
                "ok": r.ok,
                "parsed_year": _extract_active_school_year(data),
                "snippet": (str(data)[:300] if isinstance(data, dict) else str(data)),
            })
        except Exception as e:
            attempts.append({"url": url, "body": body, "error": str(e)})
    today = date.today()
    heuristic = today.year if today.month >= 7 else today.year - 1
    return jsonify({
        "host": HOST,
        "unitGuid_env": os.getenv("SKOLA24_UNIT_GUID"),
        "attempts": attempts,
        "heuristic_schoolYear": heuristic,
    })


@skola24_bp.route("/", methods=["GET"], strict_slashes=False)
def root():
    return jsonify({
        "service": "Skola24 -> ICS",
        "host": HOST,
        "school": SCHOOL_NAME,
        "endpoints": [f"/ics/{c}" for c in DEFAULT_CLASSES],
        "defaults": {"weeks_back": DEFAULT_WEEKS_BACK, "weeks_ahead": DEFAULT_WEEKS_AHEAD},
        "tips": [
            "/skola24/units listar enheter",
            "/skola24/units/debug visar råförsök",
            "/skola24/schoolyears/debug visar årförsök",
            "Sätt SKOLA24_UNIT_GUID om namnsökning inte hittar rätt",
        ],
    })
@skola24_bp.route("/render/debug/<klass>", methods=["GET"], strict_slashes=False)
def render_debug(klass: str):
    from datetime import date
    unit_guid = get_unit_guid()
    school_year = os.getenv("SKOLA24_SCHOOL_YEAR_GUID") or get_active_school_year_guid()
    qweek = request.args.get("week", "").strip()
    if qweek.isdigit():
        week = int(qweek)
        iso_year = int(request.args.get("isoyear", date.today().isocalendar().year))
    else:
        today = date.today()
        iso_year, week, _ = today.isocalendar()
    lessons = render_week(klass, iso_year, school_year, week, unit_guid)
    return jsonify({"iso_year": iso_year, "week": week, "school_year": school_year,
                    "unit_guid": unit_guid, "count": len(lessons),
                    "sample": lessons[:3]})
@skola24_bp.route("/render/attempts/<klass>", methods=["GET"], strict_slashes=False)
def render_attempts(klass: str):
    """Testa olika selectionType + signature-varianter för en given vecka."""
    from datetime import date
    unit_guid = get_unit_guid()
    school_year = os.getenv("SKOLA24_SCHOOL_YEAR_GUID") or get_active_school_year_guid()

    # vecka att testa
    qweek = request.args.get("week", "").strip()
    if qweek.isdigit():
        week = int(qweek)
        iso_year = int(request.args.get("isoyear", date.today().isocalendar().year))
    else:
        today = date.today()
        iso_year, week, _ = today.isocalendar()

    rk = get_render_key()
    signature_texts = [
        klass.strip(),
        f"{klass.strip()} ({SCHOOL_NAME})",
        f"{klass.strip()} {SCHOOL_NAME}",
    ]
    attempts = []
    for st in (4, 0, 7, 5, 1, 3):
        for txt in signature_texts:
            try:
                sel = encrypt_signature(txt)
                body = {
                    "blackAndWhite": False,
                    "customerKey": "",
                    "endDate": None,
                    "height": 550,
                    "host": HOST,
                    "periodText": "",
                    "privateFreeTextMode": False,
                    "privateSelectionMode": None,
                    "renderKey": rk,
                    "scheduleDay": 0,
                    "schoolYear": school_year,
                    "selection": sel,
                    "selectionType": st,
                    "showHeader": False,
                    "startDate": None,
                    "unitGuid": unit_guid,
                    "week": week,
                    "width": 1200,
                    "year": iso_year,
                }
                r = sess.post(URL_RENDER, json=body, headers=COMMON_HEADERS, timeout=30)
                ok = r.ok
                try:
                    data = r.json()
                    cnt = len((data.get("data") or {}).get("lessonInfo") or [])
                    snip = str(data)[:280]
                except Exception:
                    cnt = -1
                    snip = r.text[:280]
                attempts.append({"selectionType": st, "txt": txt, "status": r.status_code, "ok": ok, "count": cnt, "snippet": snip})
            except Exception as e:
                attempts.append({"selectionType": st, "txt": txt, "error": str(e)})

    return jsonify({
        "host": HOST,
        "school": SCHOOL_NAME,
        "unit_guid": unit_guid,
        "school_year": school_year,
        "iso_year": iso_year,
        "week": week,
        "attempts": attempts,
    })
@skola24_bp.route("/classes", methods=["GET"], strict_slashes=False)
def list_classes():
    unit_guid = get_unit_guid()
    body = {
        "hostname": HOST,
        "unitGuid": unit_guid,
        "filters": { "class": "true" }
    }
    r = sess.post("https://web.skola24.se/api/get/timetable/selection", json=body, headers=COMMON_HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    classes = (((data or {}).get("data") or {}).get("classes") or [])
    return jsonify([
        {"groupName": c.get("groupName"), "groupGuid": c.get("groupGuid")}
        for c in classes
    ])
