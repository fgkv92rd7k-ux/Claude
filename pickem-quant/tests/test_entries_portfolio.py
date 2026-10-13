import os
import numpy as np
from pickem_quant.schema import Leg
from pickem_quant.correlation import load_priors
from pickem_quant.simulate import simulate
from pickem_quant.entries import generate_candidates
from pickem_quant.portfolio import optimize, return_matrices
from pickem_quant.payouts import entry_ev_independent


def legs_set():
    L = []
    for i, (pl, tm, g, p) in enumerate([("A", "T1", "G1", 0.60), ("B", "T2", "G1", 0.58), ("C", "T3", "G2", 0.57), ("D", "T4", "G2", 0.56),
                                        ("E", "T5", "G3", 0.555), ("F", "T6", "G3", 0.55), ("G", "T7", "G4", 0.545)]):
        L.append(Leg(id=f"l{i}", player=pl, team=tm, game_id=g, market="nba_points", line=20.5, side="over", p=p))
    return L


def test_candidates_respect_constraints_and_match_independent_ev(root, cfg, table):
    pri = {"fallback": {"same_player": 0, "same_team": 0, "opponents": 0, "same_game": 0, "different_game": 0}, "rules": []}
    legs = legs_set()
    sim = simulate(legs, pri, 60000, 11)
    cfg["entries"]["min_distinct_games"] = 2
    cands = generate_candidates(sim, legs, table, cfg, {"mode": "stake_not_returned"})
    assert cands
    by_id = {l.id: l for l in legs}
    for e in cands:
        assert len({by_id[i].player for i in e.legs}) == e.n
        assert len({by_id[i].game_id for i in e.legs}) >= 2
        ev_ind, _ = entry_ev_independent([by_id[i].p for i in e.legs], e.mode, table)
        assert abs(e.ev_cash - ev_ind) < 0.06 * (1 + abs(ev_ind)) + 0.03   # Monte Carlo tolerance


def test_optimizer_respects_budgets_caps_and_ladder(root, cfg, table):
    pri = load_priors(os.path.join(root, "config", "correlation_priors.json"))
    legs = legs_set()
    sim = simulate(legs, pri, 30000, 5)
    cands = generate_candidates(sim, legs, table, cfg, {"mode": "stake_not_returned"})
    budgets = {"cash": 25.0, "promo": 25.0}
    for objective in ("mvo", "kelly"):
        alloc = optimize(cands, sim, table, cfg, budgets, cash_bankroll=100.0, promo_rules={"mode": "stake_not_returned"}, objective=objective)
        sc, sp = sum(alloc.stakes_cash.values()), sum(alloc.stakes_promo.values())
        assert sc <= 25.0 + 1e-9 and sp <= 25.0 + 1e-9
        assert sp > 0                                    # free promo money always deploys on +conversion entries
        for v in list(alloc.stakes_cash.values()) + list(alloc.stakes_promo.values()):
            assert v >= 1.0 and abs(v / 0.5 - round(v / 0.5)) < 1e-9
        assert len(alloc.stakes_cash) <= cfg["portfolio"]["cash"]["max_entries"]
        assert len(alloc.stakes_promo) <= cfg["portfolio"]["promo"]["max_entries"]
        for leg, ex in alloc.stats["leg_exposure"].items():
            assert ex["cash"] <= 25.0 * cfg["portfolio"]["cash"]["max_leg_exposure_pct_of_budget"] + 1e-9
            assert ex["promo"] <= 25.0 * cfg["portfolio"]["promo"]["max_leg_exposure_pct_of_budget"] + 1e-9


def test_no_cash_when_everything_negative(root, cfg, table):
    pri = {"fallback": {"same_player": 0, "same_team": 0, "opponents": 0, "same_game": 0, "different_game": 0}, "rules": []}
    legs = [Leg(id=f"l{i}", player=f"P{i}", team=f"T{i}", game_id=f"G{i}", market="nba_points", line=20.5, side="over", p=0.52) for i in range(5)]
    sim = simulate(legs, pri, 20000, 2)
    cfg["entries"]["min_ev_cash"] = -10.0           # let negative-EV candidates through to the optimizer
    cands = generate_candidates(sim, legs, table, cfg, {"mode": "stake_not_returned"})
    alloc = optimize(cands, sim, table, cfg, {"cash": 25.0, "promo": 0.0}, cash_bankroll=100.0, promo_rules={"mode": "stake_not_returned"})
    assert sum(alloc.stakes_cash.values()) == 0.0 and sum(alloc.stakes_promo.values()) == 0.0
