# backend/routes/google_ics.py
import os
import datetime as dt
from typing import List, Dict, Optional

import requests
from flask import Blueprint, request, jsonify
from icalendar import Calendar
from dateutil.tz import gettz

bp = Blueprint("google_ics", __name__)

TZ = gettz("Europe/Stockholm")
CACHE_TTL = dt.timedelta(minutes=5)
_cache_until: Optional[dt.datetime] = None
_cache_events: List[Dict] = []

def _to_iso(x):
    # x kan vara date eller datetime
    if hasattr(x, "hour"):  # datetime
        if x.tzinfo is None:
            x = x.replace(tzinfo=TZ)
        return x.isoformat()
    else:
        return dt.datetime(x.year, x.month, x.day, tzinfo=TZ).isoformat()

def _parse_ics(ics_bytes: bytes) -> List[Dict]:
    cal = Calendar.from_ical(ics_bytes)
    out: List[Dict] = []
    for ev in cal.walk("vevent"):
        start = ev.decoded("dtstart")
        end = ev.decoded("dtend", default=None)
        summary = str(ev.get("summary") or "")
        location = str(ev.get("location") or "")
        uid = str(ev.get("uid") or "")
        all_day = not hasattr(start, "hour")
        out.append({
            "id": uid,
            "summary": summary,
            "location": location,
            "start": _to_iso(start),
            "end": (_to_iso(end) if end else None),
            "allDay": all_day,
            "source": "google-ics",
        })
    return out

def _refresh() -> List[Dict]:
    urls = [u.strip() for u in os.getenv("ICS_URLS", "").split(",") if u.strip()]
    if not urls:
        return []
    events: List[Dict] = []
    for url in urls:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        events.extend(_parse_ics(r.content))

    # sortera + enkel dedup på (id, start)
    events.sort(key=lambda e: (e["start"], e["summary"]))
    uniq = {}
    for e in events:
        key = (e["id"], e["start"])
        if key not in uniq:
            uniq[key] = e
    return list(uniq.values())

@bp.route("/api/events", methods=["GET"])
def get_events():
    global _cache_until, _cache_events
    now = dt.datetime.now(TZ)
    if _cache_until is None or now >= _cache_until:
        try:
            _cache_events = _refresh()
            _cache_until = now + CACHE_TTL
        except Exception as e:
            if _cache_events:
                # returnera gammal cache om vi har en
                pass
            else:
                return jsonify({"error": str(e)}), 502

    # valfri filtrering med timeMin/timeMax (ISO8601)
    time_min = request.args.get("timeMin")
    time_max = request.args.get("timeMax")

    def in_range(e):
        if not time_min and not time_max:
            return True
        s = dt.datetime.fromisoformat(e["start"])
        ok = True
        if time_min:
            ok &= s >= dt.datetime.fromisoformat(time_min)
        if time_max:
            ok &= s < dt.datetime.fromisoformat(time_max)
        return ok

    return jsonify([e for e in _cache_events if in_range(e)])
