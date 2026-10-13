"""Loading boards, quotes, configs. JSON or CSV; same column names either way."""
from __future__ import annotations

import csv
import json
import os
from typing import Any

from .schema import BoardItem, Quote


def load_json(path: str) -> Any:
    with open(path) as fh:
        return json.load(fh)


def _rows(path: str, key: str) -> list[dict]:
    if path.lower().endswith(".csv"):
        with open(path, newline="") as fh:
            return list(csv.DictReader(fh))
    raw = load_json(path)
    if isinstance(raw, dict):
        return raw.get(key, raw.get("rows", []))
    return raw


def _f(v, default=None):
    if v in (None, ""):
        return default
    return float(v)


def load_board(path: str) -> tuple[str, list[BoardItem]]:
    raw = load_json(path) if not path.lower().endswith(".csv") else {}
    slate_id = raw.get("slate_id", os.path.splitext(os.path.basename(path))[0]) if isinstance(raw, dict) else os.path.basename(path)
    items = []
    for r in _rows(path, "items"):
        sides = r.get("sides_allowed") or ("over", "under")
        if isinstance(sides, str):
            sides = tuple(s.strip() for s in sides.split("|") if s.strip())
        items.append(BoardItem(player=r["player"], market=r["market"], line=float(r["line"]), team=r.get("team", "") or "",
                               opponent=r.get("opponent", "") or "", game_id=r.get("game_id", "") or "",
                               start_time=r.get("start_time") or None, pick_type=r.get("pick_type", "standard") or "standard",
                               multiplier_mod=_f(r.get("multiplier_mod"), 1.0), sides_allowed=tuple(sides)))
    return slate_id, items


def load_quotes(path: str) -> list[Quote]:
    out = []
    for r in _rows(path, "quotes"):
        out.append(Quote(player=r["player"], market=r["market"], line=float(r["line"]), book=r["book"],
                         price_over=float(r["price_over"]), price_under=float(r["price_under"]),
                         team=r.get("team", "") or "", game_id=r.get("game_id", "") or "", ts=r.get("ts") or None))
    return out


def load_config(path: str) -> dict:
    cfg = load_json(path)
    base = os.path.dirname(os.path.abspath(path))
    root = os.path.dirname(base) if os.path.basename(base) == "config" else base
    for k in ("payout_table", "sigma_priors", "correlation_priors"):
        p = cfg.get(k)
        if p and not os.path.isabs(p) and not os.path.exists(p):
            cand = os.path.join(root, p)
            if os.path.exists(cand):
                cfg[k] = cand
    cfg["_root"] = root
    return cfg
