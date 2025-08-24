print("✅ ai_agent.py laddas in")

import os
import json
import uuid
import logging
import datetime
from collections import defaultdict
from pathlib import Path  # <-- lägg till denna rad

import requests
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI

# --- Paths (robusta) ---
HERE = Path(__file__).resolve().parent
DATA_DIR = (HERE / "../data").resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

LOG_PATH = DATA_DIR / "middag_logg.txt"

# --- Logging: init efter att katalogen finns ---
for h in logging.root.handlers[:]:
    logging.root.removeHandler(h)
logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s - %(message)s"
)
logging.info("🪵 ai_agent.py importerad")

# --- Miljö ---
# Ladda .env i backend-katalogen (utöver systemd EnvironmentFile)
load_dotenv(HERE / ".env")
print("✅ .env laddad")
print("🔑 SUPABASE_URL:", os.getenv("SUPABASE_URL"))
print("🔑 OPENAI_API_KEY finns:", bool(os.getenv("OPENAI_API_KEY")))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4")
OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "1"))
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "1500"))
INPUT_PRICE = float(os.getenv("OPENAI_INPUT_PRICE_PER_1K", "0"))
OUTPUT_PRICE = float(os.getenv("OPENAI_OUTPUT_PRICE_PER_1K", "0"))
USD_TO_SEK = float(os.getenv("USD_TO_SEK", "1"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai = OpenAI(api_key=OPENAI_KEY)

# ------------------------------
# Konstanter / preferenser (laddas från .secrets)
# ------------------------------
def _load_ai_config():
    """Läs personlig konfig från AI_CONFIG_PATH eller använda bra defaults."""
    # Sökordning: env -> ../.secrets -> ./.secrets
    env_path = os.getenv("AI_CONFIG_PATH")
    if env_path:
        path = Path(env_path).expanduser().resolve()
    else:
        path = (HERE / "../.secrets/ai_config.json")
    cfg = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
    except FileNotFoundError:
        pass
    # Fallbacks om filen/fält saknas
    return {
        "ALLERGIES": cfg.get("ALLERGIES", ["nötter"]),
        "PREFERENCES": cfg.get("PREFERENCES", "Barnfamilj, barnvänliga rätter och variation."),
        "FORBIDDEN_INGREDIENTS": cfg.get("FORBIDDEN_INGREDIENTS", ["jordnöt"])
    }

_CFG = _load_ai_config()
ALLERGIES = _CFG["ALLERGIES"]
PREFERENCES = _CFG["PREFERENCES"]
FORBIDDEN_INGREDIENTS = _CFG["FORBIDDEN_INGREDIENTS"]

STATUS_PATH = str(DATA_DIR / "ai_status.json")
MATSEDEL_PATH = str(DATA_DIR / "matsedel.json")

CATEGORIES_TO_SKIP = [
    "salt", "peppar", "oregano", "curry", "grillkrydda", "rosmarin", "buljong", "timjan",
    "basilika", "chilipulver", "krydda", "paprikapulver"
]

STORE_ISLE_ORDER = [
    "Bröd", "Frukt & Grönt", "Mejeri", "Kött", "Kyckling", "Korv",
    "Fisk", "Frys", "Torrvaror", "Såser", "Konserver", "Övrigt"
]

CATEGORY_MAP = {
    "Kycklingfilé": "Kyckling",
    "Köttfärs": "Kött",
    "Fläskfilé": "Kött",
    "Korv": "Korv",
    "Grädde": "Mejeri",
    "Mjölk": "Mejeri",
    "Smör": "Mejeri",
    "Ost": "Mejeri",
    "Potatis": "Frukt & Grönt",
    "Lök": "Frukt & Grönt",
    "Morötter": "Frukt & Grönt",
    "Broccoli": "Frukt & Grönt",
    "Tomat": "Frukt & Grönt",
    "Gurka": "Frukt & Grönt",
    "Ris": "Torrvaror",
    "Pasta": "Torrvaror",
    "Tacobröd": "Bröd",
    "Tacoskal": "Bröd",
    "Gräddfil": "Mejeri",
    "Tomatsås": "Såser",
    "Krossade tomater": "Konserver",
    "Lingonsylt": "Konserver",
    "Tacokrydda": "Såser",
    "Dressing": "Såser",
}

SCHOOL_LUNCH_URL = os.getenv("SCHOOL_LUNCH_URL", "https://192.168.50.230:3443")
SCHOOL_LUNCH_VERIFY_SSL = os.getenv("SCHOOL_LUNCH_VERIFY_SSL", "true").lower() == "true"

# ------------------------------
# Hjälpfunktioner
# ------------------------------
def get_current_week() -> int:
    return datetime.date.today().isocalendar()[1]


def _norm_day(s: str) -> str:
    if not s:
        return ""
    s = s.strip().lower()
    mapping = {
        "må": "måndag", "mån": "måndag", "måndag": "måndag",
        "ti": "tisdag", "tis": "tisdag", "tisdag": "tisdag",
        "on": "onsdag", "ons": "onsdag", "onsdag": "onsdag",
        "to": "torsdag", "tor": "torsdag", "torsdag": "torsdag",
        "fr": "fredag", "fre": "fredag", "fredag": "fredag",
        "lö": "lördag", "lör": "lördag", "lördag": "lördag",
        "sö": "söndag", "sön": "söndag", "söndag": "söndag",
    }
    return mapping.get(s, s).capitalize()


def fetch_school_lunches():
    """
    Hämtar skolmaten via /api/mealplan/school-lunch.
    Returnerar lista av {"dag": "Måndag", "beskrivning": "..."}.
    Robust mot SSL-bekymmer och http/https.
    """
    base = (SCHOOL_LUNCH_URL or "").rstrip("/")
    if not base:
        logging.info("Ingen SCHOOL_LUNCH_URL satt; hoppar över skolmat.")
        return []

    url_https = f"{base}/api/mealplan/school-lunch"
    candidates = [{"url": url_https, "verify": SCHOOL_LUNCH_VERIFY_SSL}]
    if url_https.startswith("https://"):
        candidates.append({"url": url_https, "verify": False})
        candidates.append({"url": url_https.replace("https://", "http://", 1), "verify": True})

    last_err = None
    for c in candidates:
        try:
            logging.info("🍽️ Hämtar skolmat från %s (verify=%s)...", c["url"], c["verify"])
            res = requests.get(c["url"], timeout=12, verify=c["verify"])
            res.raise_for_status()
            data = res.json() or {}
            dagar = data.get("dagar") or []
            normalized = []
            for d in dagar:
                dag_raw = d.get("dag") or d.get("Dag") or d.get("weekday") or ""
                beskrivning = d.get("beskrivning") or d.get("Beskrivning") or d.get("description") or ""
                normalized.append({"dag": _norm_day(dag_raw), "beskrivning": (beskrivning or "").strip()})
            logging.info("✅ Skolmat hämtad (%d dagar).", len(normalized))
            return normalized
        except Exception as e:
            last_err = e
            logging.warning("⚠️ Misslyckades med %s (%s). Provar nästa...", c["url"], e)
    logging.warning("❌ Kunde inte hämta skolmat: %s", last_err)
    return []


def fetch_liked_meals(limit=10):
    """Hämta mest gillade rätter (titlar) och returnera topp N."""
    logging.info("🔍 Hämtar gillade måltider...")
    res = supabase.table("meal_likes").select("titel").limit(200).execute()
    titles = [r["titel"] for r in (res.data or []) if r.get("titel")]
    freq = defaultdict(int)
    for t in titles:
        freq[t] += 1
    top = sorted(freq.items(), key=lambda x: (-x[1], x[0]))
    return [t[0] for t in top[:limit]]


def fetch_recent_dinners():
    """Hämta middagar från senaste 4 veckorna (exkl. tacos) för att undvika upprepning."""
    recent_weeks = [get_current_week() - i for i in range(1, 5)]
    res = supabase.table("mealplan").select("data").in_("vecka", recent_weeks).execute()
    dinners = []
    for row in (res.data or []):
        dagar = (row.get("data") or {}).get("dagar", [])
        for dag in dagar:
            middag = dag.get("middag")
            if middag:
                titel = middag.get("titel")
                if titel and "taco" not in titel.lower():
                    dinners.append(titel)
    return dinners


def is_spice(name: str) -> bool:
    return any(word in name.lower() for word in CATEGORIES_TO_SKIP)


# ==============================
# Bygger inköpslista från middagar
# ==============================
def build_shopping_items(matsedel: dict, week: int):
    """
    Bygger inköpslista från alla middags-ingredienser i en matsedel/plan.
    Aggregerar mängder när det går. Skippar kryddor.
    """
    print("Extraherar shoppinglist...")
    grouped = defaultdict(lambda: {"amount": 0, "unit": None})

    for dag in matsedel.get("dagar", []):
        middag = dag.get("middag")
        if not middag:
            continue
        for ingrediens in middag.get("ingredienser", []):
            parts = ingrediens.strip().split("(")
            name = parts[0].strip()
            if is_spice(name):
                continue

            raw_amount = parts[1][:-1].strip() if len(parts) > 1 else None
            value = None
            unit = raw_amount
            if raw_amount:
                try:
                    v, u = raw_amount.split(" ", 1)
                    value = float(v.replace(",", "."))
                    unit = u
                except Exception:
                    value = None
                    unit = raw_amount

            key = f"{name} ({unit})" if unit else name

            if value is not None:
                grouped[key]["amount"] += value
                grouped[key]["unit"] = unit
            else:
                grouped[key]["amount"] = None
                grouped[key]["unit"] = unit

    items = []
    for idx, (key, val) in enumerate(grouped.items()):
        name = key.split(" (")[0]
        amount = f"{val['amount']} {val['unit']}" if val["amount"] is not None else val["unit"]
        category = CATEGORY_MAP.get(name, "Övrigt")
        sortorder = STORE_ISLE_ORDER.index(category) if category in STORE_ISLE_ORDER else 999

        items.append({
            "idx": idx,
            "id": str(uuid.uuid4()),
            "item": name,
            "amount": amount,
            "checked": False,
            "week": week,
            "category": category,
            "created_at": datetime.datetime.now().isoformat(),
            "data": None,
            "source": "ai",
            "sortorder": sortorder
        })

    return items

# Bakåtkompatibelt alias (om något anropar gamla namnet)
build_shopping_items = build_shopping_items


def upload_shoppinglist(week: int, items: list):
    print("Rensar tidigare AI-shoppinglist för veckan...")
    supabase.table("shoppinglist").delete().eq("week", week).eq("source", "ai").execute()
    print("Laddar upp shoppinglist...")
    if items:
        supabase.table("shoppinglist").insert(items).execute()


def upload_mealplan(week: int, matsedel: dict):
    print("Rensar tidigare mealplan för veckan...")
    supabase.table("mealplan").delete().eq("vecka", week).execute()
    print("Laddar upp mealplan...")
    supabase.table("mealplan").insert({"vecka": week, "data": matsedel}).execute()


def save_matsedel_local(matsedel: dict):
    print("Sparar lokalt...")
    with open(MATSEDEL_PATH, "w") as f:
        json.dump(matsedel, f, indent=2, ensure_ascii=False)


def log_status(success: bool, message: str):
    with open(STATUS_PATH, "w") as f:
        json.dump({
            "success": success,
            "message": message,
            "timestamp": datetime.datetime.now().isoformat()
        }, f, indent=2, ensure_ascii=False)

# ------------------------------
# Veckogenerering
# ------------------------------
def build_prompt(school_lunches, recent_dinners, liked_meals):
    lunch_text = "\n".join(f"{d['dag']}: {d['beskrivning']}" for d in school_lunches)
    return f'''
Du är en svensk matinspiratör som planerar matsedel för en familj med två vuxna och två barn.

- Allergier: {', '.join(ALLERGIES)}
- Preferenser: {PREFERENCES}
- Familjen har gillat dessa rätter tidigare: {json.dumps(liked_meals, ensure_ascii=False)}
  Använd gärna liknande smaker som inspiration.
- Kalorimål: ca 700-900 kcal/middag för vuxna (totalt 1500 kcal/dag)
- Dagens totala kaloriintag för de vuxna får inte överstiga 1500 kcal
- Om lunch + middag överstiger detta, föreslå mindre portioner eller utbyte av kolhydrater för de vuxna (t.ex. ersätt ris med blomkålsris)

- Vardagar (Måndag–Fredag): sätt lunch.titel EXAKT till skolmaten nedan för respektive dag. Ändra inte texten.
- Helg (Lördag–Söndag): planera både lunch och middag.

- Kopiera skolmaten (nedan) till lunch för rätt veckodag, utan att ändra innehållet. Ange endast titel:
{lunch_text}

- Undvik att upprepa någon middag från de senaste 4 veckorna, utom tacos på fredagar - den får alltid vara med:
{json.dumps(recent_dinners, indent=2, ensure_ascii=False)}

Returnera ENDAST ett giltigt JSON-objekt enligt:

{{
  "vecka": <veckonummer>,
  "dagar": [
    {{
      "dag": "Måndag",
      "lunch": {{
        "titel": "Grönsakslasagne",
        "recept": null,
        "kalorier": null
      }},
      "middag": {{
        "titel": "Exempelrätt",
        "ingredienser": [
          "Ingrediens 1 (500g)",
          "Ingrediens 2 (1 burk)"
        ],
        "kalorier": 850,
        "recept": "https://www.exempel.se/recept"
      }}
    }},
    ...
  ]
}}

- Veckonumret ska vara {get_current_week()}
- Inkludera uppskattade mängder i parentes för varje ingrediens
- Lägg till en svensk receptlänk (ICA, Coop, Arla, Tasteline) till varje middag
- Inga kommentarer före eller efter JSON:en
'''


def generate_meal_plan():
    print("🤖 Börjar generera matsedel...")
    school_lunches = fetch_school_lunches()
    recent_dinners = fetch_recent_dinners()
    liked_meals = fetch_liked_meals()
    prompt = build_prompt(school_lunches, recent_dinners, liked_meals)

    completion = openai.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=OPENAI_TEMPERATURE
    )

    raw = completion.choices[0].message.content.strip()
    usage = completion.usage
    pt = getattr(usage, "prompt_tokens", 0)
    ct = getattr(usage, "completion_tokens", 0)
    cost_usd = (pt/1000.0)*INPUT_PRICE + (ct/1000.0)*OUTPUT_PRICE
    cost_sek = cost_usd * USD_TO_SEK

    logging.info(
        f"💰Generering av Veckomeny: Tokens prompt={pt}, completion={ct}, total={pt+ct}. "
        f"Cost ≈ ${cost_usd:.4f} (~{cost_sek:.2f} SEK)"
    )
    print(f"[COST] prompt={pt}, completion={ct}, total={pt+ct}, ~${cost_usd:.4f} (~{cost_sek:.2f} SEK)")
    print("GPT response:", raw)
    logging.info("🧠 GPT-svar i veckoplanering:\n%s", raw)
    return json.loads(raw)


# ------------------------------
# Sista säkerhetsnät – fyll i lunch Mån–Fre från skolmaten om saknas
# ------------------------------
def _ensure_weekday_lunches(matsedel: dict, school_lunches: list) -> dict:
    by_day = {d["dag"]: d["beskrivning"] for d in school_lunches if d.get("dag") and d.get("beskrivning")}
    vardagar = {"Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"}
    patched = 0
    for dag in matsedel.get("dagar", []):
        name = (dag.get("dag") or "").strip()
        if name in vardagar and by_day.get(name):
            if not dag.get("lunch") or not (dag["lunch"].get("titel") or "").strip():
                dag["lunch"] = {"titel": by_day[name], "recept": None, "kalorier": None}
                patched += 1
    if patched:
        logging.info("🩹 Fyllde i lunch för %d vardagar baserat på skolmaten.", patched)
    return matsedel


# ------------------------------
# Enskild middag (🔁 Byt middag)
# ------------------------------
def _is_safe(middag: dict) -> bool:
    if not middag:
        return False
    combined = (middag.get("titel", "") + " " + " ".join(middag.get("ingredienser", []))).lower()
    for word in FORBIDDEN_INGREDIENTS:
        if word in combined:
            logging.warning(f"🚫 Förbjuden ingrediens i '{middag.get('titel')}': {word}")
            return False
    return True


def generate_dinner_for_day(vecka: int, dagNamn: str) -> dict:
    logging.info(f"🔁 Genererar ny middag för {dagNamn} i vecka {vecka}...")
    print("🤖 Börjar generera mat för enskild dag...")

    recent_dinners = fetch_recent_dinners()
    liked_meals = fetch_liked_meals()
    seed = str(uuid.uuid4())[:8]

    prompt = f"""
Du är en svensk matinspiratör som ska föreslå EN ny middag för en barnfamilj med två vuxna och två barn.

⚠️ VIKTIGT:
En familjemedlem har livshotande allergi mot:
{', '.join(FORBIDDEN_INGREDIENTS)}
Föreslå aldrig något som innehåller någon av ovan ingredienser (risk för anafylaktisk chock).

- Dagen är {dagNamn}, vecka {vecka}
- Inspireras gärna av dessa gillade rätter: {json.dumps(liked_meals, ensure_ascii=False)}
- Undvik dessa nyligen serverade rätter: {json.dumps(recent_dinners, ensure_ascii=False)}
- Middagen ska innehålla ca 700–900 kcal

Returnera ENDAST giltig JSON i följande format:

{{
  "middag": {{
    "titel": "Exempelrätt",
    "ingredienser": [
      "Ingrediens 1 (500g)",
      "Ingrediens 2 (1 burk)"
    ],
    "kalorier": 850,
    "recept": "https://www.exempel.se/recept"
  }},
  "motivering": "Max 2–3 meningar: varför det passar med hänsyn till variation, näring och allergier."
}}

- Inga kommentarer före eller efter JSON:en
- Prompt-id: {seed}
"""

    middag = None
    last_error = None
    for attempt in range(3):
        logging.info(f"🌀 Försök {attempt + 1} (seed={seed})")
        completion = openai.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=OPENAI_TEMPERATURE
        )
        raw = completion.choices[0].message.content.strip()
        usage = completion.usage
        pt = getattr(usage, "prompt_tokens", 0)
        ct = getattr(usage, "completion_tokens", 0)
        cost_usd = (pt/1000.0)*INPUT_PRICE + (ct/1000.0)*OUTPUT_PRICE
        cost_sek = cost_usd * USD_TO_SEK

        logging.info(
           f"💰Byte av en middag: Tokens prompt={pt}, completion={ct}, total={pt+ct}. "
           f"Cost ≈ ${cost_usd:.4f} (~{cost_sek:.2f} SEK)"
        )
        print(f"[COST] prompt={pt}, completion={ct}, total={pt+ct}, ~${cost_usd:.4f} (~{cost_sek:.2f} SEK)")
        logging.info("🔤 GPT-svar (enkild middag):\n%s", raw)
        try:
            parsed = json.loads(raw)
            if "middag" in parsed:
                kandidat = parsed["middag"]
                motivering = parsed.get("motivering")
            else:
                kandidat = parsed
                motivering = None

            if _is_safe(kandidat):
                middag = kandidat
                if motivering:
                    middag["motivering"] = motivering
                break
            else:
                last_error = "Allergenkrock"
        except Exception as e:
            last_error = f"JSON-fel: {e}"

    if not middag:
        raise Exception(f"🚨 Kunde inte generera säker middag efter 3 försök. Orsak: {last_error or 'okänd'}")

    # Uppdatera mealplan
    data = supabase.table("mealplan").select("id", "data").eq("vecka", vecka).limit(1).execute()
    if not data.data:
        raise Exception("Kunde inte hitta befintlig mealplan.")
    plan = data.data[0]["data"]
    for dag in plan.get("dagar", []):
        if dag.get("dag") == dagNamn:
            dag["middag"] = middag
    supabase.table("mealplan").update({"data": plan}).eq("vecka", vecka).execute()

    # Regenerera shoppinglista
    shopping_items = build_shopping_items(plan, vecka)
    upload_shoppinglist(vecka, shopping_items)

    return middag

# ------------------------------
# Huvudflöde (veckokörning)
# ------------------------------
def run():
    print("▶️ run() körs")
    try:
        week = get_current_week()
        print("📅 Vecka som planeras:", week)
        matsedel = generate_meal_plan()
        matsedel["vecka"] = week

        # Sista säkerhetsnät: fyll i luncher på vardagar om de saknas
        school_lunches = fetch_school_lunches()
        matsedel = _ensure_weekday_lunches(matsedel, school_lunches)

        save_matsedel_local(matsedel)

        shopping_items = build_shopping_items(matsedel, week)
        upload_shoppinglist(week, shopping_items)

        upload_mealplan(week, matsedel)
        log_status(True, "AI-agenten skapade veckans matsedel")
    except Exception as e:
        print("❌ Fel i run():", str(e))
        logging.error(f"Fel i run(): {e}")
        log_status(False, f"Fel: {str(e)}")

if __name__ == "__main__":
    import sys
    try:
        rc = run()  # <-- kör huvudflödet
        print("✅ run() klart")
        # Om run() inte returnerar något: behandla som 0 (OK)
        sys.exit(0 if (rc is None or rc == 0) else int(rc))
    except Exception as e:
        print(f"❌ Fel i __main__: {e}")
        sys.exit(1)
