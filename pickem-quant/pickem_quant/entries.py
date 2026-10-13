"""Candidate entry generation: beam search on joint hit probability under the correlated simulation."""
from __future__ import annotations

from itertools import combinations
from typing import Sequence

import numpy as np

from .payouts import PayoutTable, promo_cash_vector, poisson_binomial
from .schema import Entry, Leg
from .simulate import Simulation


def _ok_subset(legs: Sequence[Leg], max_per_player: int, min_games: int) -> bool:
    players = {}
    for l in legs:
        players[l.player.lower()] = players.get(l.player.lower(), 0) + 1
    if max(players.values()) > max_per_player:
        return False
    if len({l.game_id for l in legs}) < min(min_games, len(legs)):
        return False
    return True


def score_entry(sim: Simulation, leg_ids: Sequence[str], mode: str, table: PayoutTable,
                legs_by_id: dict, promo_rules: dict | None) -> Entry | None:
    n = len(leg_ids)
    if not table.has(mode, n):
        return None
    mod = float(np.prod([legs_by_id[i].multiplier_mod for i in leg_ids]))
    dist = sim.hit_distribution(leg_ids)
    pay = table.payout_vector(mode, n) * mod
    ret = pay - 1.0
    ev = float(dist @ ret)
    var = float(dist @ (ret - ev) ** 2)
    promo = promo_cash_vector(pay, promo_rules)
    ev_promo = float(dist @ promo)
    ev_indep = float(poisson_binomial([legs_by_id[i].p for i in leg_ids]) @ ret)
    return Entry(legs=tuple(leg_ids), mode=mode, n=n, multiplier_mod=mod, p_all=float(dist[n]),
                 ev_cash=ev, ev_cash_indep=ev_indep, ev_promo=ev_promo, sd_cash=float(np.sqrt(max(var, 0.0))),
                 hit_dist={int(k): float(v) for k, v in enumerate(dist)})


def generate_candidates(sim: Simulation, legs: Sequence[Leg], table: PayoutTable, cfg: dict,
                        promo_rules: dict | None = None) -> list[Entry]:
    ecfg = cfg.get("entries", {})
    sizes = [int(s) for s in ecfg.get("sizes", [2, 3, 4, 5, 6])]
    modes = list(ecfg.get("modes", ["perfect", "flex"]))
    beam_width = int(ecfg.get("beam_width", 40))
    top_k = int(ecfg.get("top_k_legs", 14))
    max_candidates = int(ecfg.get("max_candidates", 60))
    max_per_player = int(ecfg.get("max_per_player", 1))
    min_games = int(ecfg.get("min_distinct_games", 1))
    min_ev_cash = float(ecfg.get("min_ev_cash", 0.0))

    legs = sorted(legs, key=lambda l: -l.p)[:top_k]
    legs_by_id = {l.id: l for l in legs}
    ids = [l.id for l in legs]
    found: dict[str, Entry] = {}

    def consider(subset: tuple[str, ...]):
        for mode in modes:
            e = score_entry(sim, subset, mode, table, legs_by_id, promo_rules)
            if e is not None and e.key not in found:
                found[e.key] = e

    # level 2: exhaustive over the top-K legs
    beam: list[tuple[float, tuple[str, ...]]] = []
    for a, b in combinations(ids, 2):
        sub = (a, b)
        if not _ok_subset([legs_by_id[i] for i in sub], max_per_player, min_games):
            continue
        lp = np.log(max(sim.p_all(sub), 1e-12))
        beam.append((lp, sub))
    beam.sort(key=lambda t: -t[0])
    beam = beam[:beam_width]
    if 2 in sizes:
        for _, sub in beam:
            consider(sub)

    for n in range(3, max(sizes) + 1):
        seen = set()
        nxt: list[tuple[float, tuple[str, ...]]] = []
        for _, sub in beam:
            for i in ids:
                if i in sub:
                    continue
                cand = tuple(sorted(sub + (i,)))
                if cand in seen:
                    continue
                seen.add(cand)
                if not _ok_subset([legs_by_id[j] for j in cand], max_per_player, min_games):
                    continue
                lp = np.log(max(sim.p_all(cand), 1e-12))
                nxt.append((lp, cand))
        nxt.sort(key=lambda t: -t[0])
        beam = nxt[:beam_width]
        if n in sizes:
            for _, sub in beam:
                consider(sub)
        if not beam:
            break

    cands = list(found.values())
    good = [e for e in cands if e.ev_cash > min_ev_cash]
    good.sort(key=lambda e: -e.ev_cash)
    by_promo = sorted(cands, key=lambda e: -e.ev_promo)
    out: dict[str, Entry] = {}
    for e in good[:max_candidates]:
        out[e.key] = e
    for e in by_promo[: max(8, max_candidates // 4)]:
        out.setdefault(e.key, e)
    return list(out.values())
