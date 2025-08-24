from flask import Blueprint, jsonify, current_app
import os, json

birthdays_bp = Blueprint("birthdays", __name__)

@birthdays_bp.get("/api/birthdays")
def get_birthdays():
    """
    Returnerar {"birthdays": [{"date": "3/1", "name": "Mormor"}, ...]}
    Hämtas från fil (default .secrets/birthdays.json)
    """
    path = os.getenv("BIRTHDAYS_PATH", ".secrets/birthdays.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or []
        # Liten sanering så vi inte råkar läcka konstiga fält
        out = []
        for it in data:
            date = (it.get("date") or "").strip()
            name = (it.get("name") or "").strip()
            if date and name:
                out.append({"date": date, "name": name})
        return jsonify({"birthdays": out})
    except FileNotFoundError:
        # Tyst fallback – tom lista om filen saknas
        return jsonify({"birthdays": []})
    except Exception as e:
        current_app.logger.exception("Kunde inte läsa birthdays")
        return jsonify({"error": "internal error"}), 500