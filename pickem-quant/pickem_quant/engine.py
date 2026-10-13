"""One call that runs the whole slate pipeline. The CLI and any agent protocol call this."""
from __future__ import annotations

import json
from datetime import datetime, date, timezone
from typing import Sequence

import numpy as np

from .bankroll import State, load_state, slate_budgets
from .correlation import load_priors, leg_correlation
from .entries import generate_candidates
from .io import load_json
from .payouts import PayoutTable, breakeven_per_leg, breakeven_table
from .portfolio import optimize, Allocation
from .pricing import price_board, select_legs
from .schema import BoardItem, Quote, Leg, Entry
from .simulate import simulate


def reference_breakeven(table: PayoutTable, cfg: dict) -> float:
    """The easiest breakeven among the structures we are willing to play (lowest bar a leg must clear)."""
    ecfg = cfg.get("entries", {})
    bes = []
    for mode in ecfg.get("modes", ["perfect", "flex"]):
        for n in ecfg.get("sizes", [2, 3, 4, 5, 6]):
            if table.has(mode, int(n)):
                bes.append(breakeven_per_leg(mode, int(n), table))
    return min(bes) if bes else 0.55


def run_slate(board: Sequence[BoardItem], quotes: Sequence[Quote], cfg: dict, slate_id: str = "slate",
              now: datetime | None = None, state: State | None = None, objective: str | None = None,
              overlay: dict | None = None, budgets: dict | None = None) -> dict:
    table = PayoutTable.load(cfg["payout_table"])
    sigma_priors = load_json(cfg["sigma_priors"])
    corr_priors = load_priors(cfg["correlation_priors"])
    promo_rules = cfg["bankrolls"]["promo"].get("rules", {})
    state = state or load_state(cfg.get("state_path", "state.json"), cfg)
    budgets = budgets or slate_budgets(state, cfg, (now or datetime.now(timezone.utc)).date())

    legs_all, diags = price_board(board, quotes, cfg, sigma_priors, now)
    warnings = [f"no sportsbook quotes for {d['player']} {d['market']}" for d in diags if d.get("reason")]

    if overlay:
        cap = float(cfg.get("overlay", {}).get("max_abs_logit_shift", 0.25))
        from .llm.overlay import apply_overlay
        legs_all, notes = apply_overlay(legs_all, overlay, cap)
        warnings.extend(notes)

    ref_be = reference_breakeven(table, cfg)
    legs = select_legs(legs_all, ref_be, cfg)
    result = {"slate_id": slate_id, "generated": (now or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
              "reference_breakeven": ref_be, "budgets": budgets, "state": state.to_dict(),
              "breakevens": breakeven_table(table), "payout_notes": table.notes or [],
              "warnings": warnings, "n_board_items": len(board), "n_legs_priced": len(legs_all),
              "legs_all": [l.to_dict() for l in sorted(legs_all, key=lambda l: -l.p)],
              "legs_selected": [l.to_dict() for l in legs], "candidates": [], "allocation": None}
    if len(legs) < 2:
        result["warnings"].append("fewer than two legs clear the reference breakeven: no play")
        return result

    scfg = cfg.get("simulation", {})
    sim = simulate(legs, corr_priors, int(scfg.get("scenarios", 40000)), int(scfg.get("seed", 7)))
    corr = leg_correlation(legs, corr_priors)
    result["correlation"] = {"legs": [l.id for l in legs], "matrix": np.round(corr, 3).tolist()}

    cands = generate_candidates(sim, legs, table, cfg, promo_rules)
    cands.sort(key=lambda e: -e.ev_cash)
    result["candidates"] = [e.to_dict() for e in cands]
    if not cands:
        result["warnings"].append("no candidate entry has positive EV: no play")
        return result

    alloc = optimize(cands, sim, table, cfg, budgets, state.cash, promo_rules, objective)
    result["allocation"] = alloc.to_dict()
    result["plan"] = build_plan(alloc, cands, legs)
    return result


def build_plan(alloc: Allocation, cands: Sequence[Entry], legs: Sequence[Leg]) -> list[dict]:
    by_key = {e.key: e for e in cands}
    by_id = {l.id: l for l in legs}
    plan = []
    for bk, stakes in (("cash", alloc.stakes_cash), ("promo", alloc.stakes_promo)):
        for key, stake in sorted(stakes.items(), key=lambda kv: -kv[1]):
            e = by_key[key]
            plan.append({"bankroll": bk, "stake": stake, "mode": e.mode, "n": e.n, "p_all": e.p_all,
                         "ev_per_dollar": e.ev_cash if bk == "cash" else e.ev_promo,
                         "expected_profit": stake * (e.ev_cash if bk == "cash" else e.ev_promo),
                         "entry_key": key,
                         "legs": [{"player": by_id[i].player, "team": by_id[i].team, "market": by_id[i].market,
                                   "line": by_id[i].line, "side": by_id[i].side, "p": by_id[i].p, "id": i} for i in e.legs]})
    return plan
