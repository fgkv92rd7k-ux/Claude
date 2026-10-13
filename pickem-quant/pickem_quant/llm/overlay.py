"""Bounded probability overlay from news text. The LLM proposes; the code clamps and keeps both
sides of every item consistent (p_over + p_under = 1)."""
from __future__ import annotations

from typing import Sequence

from ..odds import logit, expit
from ..schema import Leg
from .client import complete_json
from .prompts import OVERLAY_SYSTEM


def request_overlay(legs: Sequence[dict], news_text: str, provider: str = "openai", model: str | None = None, cap: float = 0.25) -> dict:
    compact = [{"leg_id": l["id"], "player": l["player"], "team": l.get("team", ""), "market": l["market"], "line": l["line"],
                "side": l["side"], "p": round(float(l["p"]), 4)} for l in legs]
    system = OVERLAY_SYSTEM.replace("CAP", f"{cap:.2f}")
    user = f"CAP = {cap:.2f}\nLegs:\n{compact}\n\nNews:\n{news_text}"
    out = complete_json(provider, model, system, user)
    adj = []
    for a in out.get("adjustments", []):
        try:
            adj.append({"leg_id": str(a["leg_id"]), "delta_logit": float(a["delta_logit"]),
                        "confidence": float(a.get("confidence", 1.0)), "reason": str(a.get("reason", ""))})
        except (KeyError, TypeError, ValueError):
            continue
    return {"cap": cap, "provider": provider, "model": model, "adjustments": adj}


def _item_key(leg: Leg) -> str:
    return f"{leg.player}|{leg.market}|{leg.line}".lower()


def apply_overlay(legs: Sequence[Leg], overlay: dict, cap: float) -> tuple[list[Leg], list[str]]:
    """Shift the OVER-logit of each item by clamp(delta)*clamp(conf); the under moves the opposite way."""
    by_id = {l.id: l for l in legs}
    shift_by_item: dict[str, list[float]] = {}
    notes = []
    for a in overlay.get("adjustments", []):
        leg = by_id.get(a.get("leg_id"))
        if leg is None:
            continue
        d = max(-cap, min(cap, float(a.get("delta_logit", 0.0))))
        c = max(0.0, min(1.0, float(a.get("confidence", 1.0))))
        shift_by_item.setdefault(_item_key(leg), []).append(d * c)
        notes.append(f"overlay: {leg.player} {leg.market} {leg.line:g} over-logit {d*c:+.3f} ({a.get('reason','')[:80]})")
    out = []
    for l in legs:
        s = shift_by_item.get(_item_key(l))
        if not s:
            out.append(l); continue
        shift = sum(s) / len(s)
        p_over = l.p if l.side == "over" else 1.0 - l.p
        p_over_new = expit(logit(p_over) + shift)
        new = Leg(**{**l.__dict__})
        new.p = p_over_new if l.side == "over" else 1.0 - p_over_new
        new.notes = list(l.notes) + [f"overlay shift {shift:+.3f} logit on over"]
        out.append(new)
    return out, notes
