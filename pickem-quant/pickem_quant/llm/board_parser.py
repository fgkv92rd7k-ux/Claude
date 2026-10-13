from __future__ import annotations

from .client import complete_json
from .prompts import BOARD_PARSER_SYSTEM

REQUIRED = ("player", "market", "line")


def parse_board_text(text: str, provider: str = "openai", model: str | None = None, sport_hint: str | None = None) -> list[dict]:
    user = (f"Sport hint: {sport_hint}\n" if sport_hint else "") + "Board text:\n" + text
    out = complete_json(provider, model, BOARD_PARSER_SYSTEM, user)
    items = []
    for it in out.get("items", []):
        if not all(k in it for k in REQUIRED):
            continue
        try:
            it["line"] = float(it["line"])
            it["multiplier_mod"] = float(it.get("multiplier_mod", 1.0) or 1.0)
        except (TypeError, ValueError):
            continue
        it.setdefault("team", ""); it.setdefault("opponent", ""); it.setdefault("game_id", "")
        it.setdefault("pick_type", "standard"); it.setdefault("start_time", None)
        items.append(it)
    return items
