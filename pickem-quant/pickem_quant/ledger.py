"""Append-only ledger of placed entries, settlement, and the metrics that tell you whether the
edge is real: ROI, closing line value (CLV), calibration (Brier / log loss / reliability bins)."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Sequence

import numpy as np

from .odds import logit
from .payouts import PayoutTable, promo_cash_vector
from .schema import Entry, Leg


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_all(path: str, records: Sequence[dict]) -> None:
    with open(path, "w") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")


def append(path: str, records: Sequence[dict]) -> None:
    with open(path, "a") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")


def plan_records(slate_id: str, allocation, entries_by_key: dict, legs_by_id: dict, ts: str | None = None) -> list[dict]:
    ts = ts or _now()
    out = []
    for bankroll, stakes in (("cash", allocation.stakes_cash), ("promo", allocation.stakes_promo)):
        for key, stake in stakes.items():
            e: Entry = entries_by_key[key]
            legs = []
            for lid in e.legs:
                l: Leg = legs_by_id[lid]
                legs.append({"id": l.id, "player": l.player, "team": l.team, "game_id": l.game_id, "market": l.market,
                             "line": l.line, "side": l.side, "p": l.p, "book_line": l.book_line, "book_p_over": l.book_p_over,
                             "result": None, "p_close": None})
            out.append({"id": uuid.uuid4().hex[:12], "ts": ts, "slate_id": slate_id, "status": "open",
                        "bankroll": bankroll, "stake": float(stake), "mode": e.mode, "n": e.n,
                        "multiplier_mod": e.multiplier_mod, "p_all": e.p_all, "ev_cash": e.ev_cash,
                        "ev_promo": e.ev_promo, "legs": legs, "payout_mult": None, "pnl": None, "cash_credited": None})
    return out


def settle(records: list[dict], results: dict, closing: dict | None, table: PayoutTable, promo_rules: dict | None) -> list[dict]:
    """results: leg_id -> 'hit' | 'miss' | 'push'; closing: leg_id -> fair prob of THAT SIDE at close."""
    closing = closing or {}
    for r in records:
        if r["status"] != "open":
            continue
        touched = False
        for l in r["legs"]:
            if l["id"] in results:
                l["result"] = results[l["id"]]
                touched = True
            if l["id"] in closing:
                l["p_close"] = float(closing[l["id"]])
        if not touched or any(l["result"] is None for l in r["legs"]):
            continue
        live = [l for l in r["legs"] if l["result"] != "push"]
        n_live = len(live)
        hits = sum(1 for l in live if l["result"] == "hit")
        if n_live < 2 or not table.has(r["mode"], n_live):
            mult = 1.0 if n_live < 2 else 0.0        # refund when the entry collapses below 2 legs
            if n_live >= 2:
                r["note"] = f"no payout tier for {r['mode']} x{n_live} after pushes; treated as 0, fix by hand"
        else:
            pay = table.payout_vector(r["mode"], n_live) * float(r.get("multiplier_mod", 1.0))
            mult = float(pay[hits])
        r["payout_mult"] = mult
        if r["bankroll"] == "cash":
            r["pnl"] = round(r["stake"] * (mult - 1.0), 2)
            r["cash_credited"] = round(r["stake"] * mult, 2)
        else:
            vec = promo_cash_vector(np.array([mult]), promo_rules)
            r["cash_credited"] = round(r["stake"] * float(vec[0]), 2)
            r["pnl"] = r["cash_credited"]
        r["hits"] = hits
        r["n_live"] = n_live
        r["status"] = "settled"
        r["settled_ts"] = _now()
    return records


def metrics(records: Sequence[dict], rolling_window: int = 150) -> dict:
    settled = [r for r in records if r["status"] == "settled"]
    out = {"n_entries": len(records), "n_settled": len(settled), "n_open": len(records) - len(settled)}
    for bk in ("cash", "promo"):
        rs = [r for r in settled if r["bankroll"] == bk]
        staked = sum(r["stake"] for r in rs)
        pnl = sum(r["pnl"] for r in rs)
        out[bk] = {"n": len(rs), "staked": round(staked, 2), "pnl": round(pnl, 2),
                   "roi": round(pnl / staked, 4) if staked > 0 else None,
                   "expected_pnl": round(sum(r["stake"] * (r["ev_cash"] if bk == "cash" else r["ev_promo"]) for r in rs), 2)}
    # leg-level: each leg counted once per entry it appears in (weights would be a refinement)
    legs = [l for r in settled for l in r["legs"] if l["result"] in ("hit", "miss")]
    if legs:
        y = np.array([1.0 if l["result"] == "hit" else 0.0 for l in legs])
        p = np.clip(np.array([l["p"] for l in legs]), 1e-6, 1 - 1e-6)
        out["legs"] = {"n": int(len(y)), "hit_rate": float(y.mean()), "mean_p": float(p.mean()),
                       "brier": float(np.mean((p - y) ** 2)),
                       "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
                       "brier_coinflip": 0.25}
        bins = {}
        edges = [0.5, 0.53, 0.56, 0.59, 0.62, 0.66, 0.72, 1.0]
        for lo, hi in zip(edges[:-1], edges[1:]):
            m = (p >= lo) & (p < hi)
            if m.any():
                bins[f"[{lo:.2f},{hi:.2f})"] = {"n": int(m.sum()), "mean_p": float(p[m].mean()), "hit_rate": float(y[m].mean())}
        out["calibration"] = bins
        by_market = {}
        for l, yy in zip(legs, y):
            d = by_market.setdefault(l["market"], {"n": 0, "hits": 0, "sum_p": 0.0})
            d["n"] += 1; d["hits"] += int(yy); d["sum_p"] += l["p"]
        out["by_market"] = {k: {"n": v["n"], "hit_rate": v["hits"] / v["n"], "mean_p": v["sum_p"] / v["n"]} for k, v in by_market.items()}
    closed = [l for r in records for l in r["legs"] if l.get("p_close") is not None]
    out["n_legs_with_close"] = len(closed)
    if closed:
        clv = np.array([logit(l["p_close"]) - logit(l["p"]) for l in closed])
        out["clv_logit_mean"] = float(clv.mean())
        out["clv_prob_mean"] = float(np.mean([l["p_close"] - l["p"] for l in closed]))
        out["clv_positive_rate"] = float((clv > 0).mean())
        out["rolling_clv_logit"] = float(clv[-rolling_window:].mean())
    return out
