"""Latent correlation structure for the Gaussian copula.

Each board ITEM (player x market x line) gets one latent normal variable. The over leg hits
when its uniform is below p_over, the under leg hits otherwise, so the two sides of one item
are exactly complementary. Correlations between items come from rule-based priors keyed on
scope (same player / same team / opponents / same game) and the pair of markets.
"""
from __future__ import annotations

import json
from typing import Sequence

import numpy as np

from .schema import Leg


def load_priors(path: str) -> dict:
    with open(path) as fh:
        return json.load(fh)


def scope_of(a: Leg, b: Leg) -> str:
    if a.player.lower() == b.player.lower():
        return "same_player"
    if a.game_id and a.game_id == b.game_id:
        if a.team and b.team and a.team.lower() == b.team.lower():
            return "same_team"
        if a.team and b.team:
            return "opponents"
        return "same_game"
    if a.team and b.team and a.team.lower() == b.team.lower():
        return "same_team"
    return "different_game"


def _market_match(rule_markets: Sequence[str], m1: str, m2: str) -> bool:
    r1, r2 = rule_markets
    return (r1 in (m1, "*") and r2 in (m2, "*")) or (r1 in (m2, "*") and r2 in (m1, "*"))


def stat_rho(a: Leg, b: Leg, priors: dict) -> float:
    sc = scope_of(a, b)
    if sc == "different_game":
        return float(priors.get("fallback", {}).get("different_game", 0.0))
    for rule in priors.get("rules", []):
        if rule.get("scope") == sc and _market_match(rule["markets"], a.market, b.market):
            return float(rule["rho"])
    return float(priors.get("fallback", {}).get(sc, 0.0))


def nearest_psd(R: np.ndarray, eps: float = 1e-6, iters: int = 5) -> np.ndarray:
    """Project a symmetric matrix onto the correlation matrices (eigen-clip + unit diagonal)."""
    A = (R + R.T) / 2.0
    for _ in range(iters):
        w, V = np.linalg.eigh(A)
        if w.min() >= eps:
            break
        w = np.clip(w, eps, None)
        A = (V * w) @ V.T
        d = np.sqrt(np.clip(np.diag(A), eps, None))
        A = A / np.outer(d, d)
        A = (A + A.T) / 2.0
    np.fill_diagonal(A, 1.0)
    return A


def item_key(leg: Leg) -> str:
    return f"{leg.player}|{leg.market}|{leg.line}".lower()


def build_item_correlation(legs: Sequence[Leg], priors: dict) -> tuple[list[str], dict, np.ndarray]:
    """Return (item_keys, leg_id -> (item_index, sign), latent correlation among items).

    The latent variable of an item is oriented toward the OVER; stat correlations between
    items therefore carry no side sign here. Side signs are applied when legs are mapped to hits.
    """
    keys: list[str] = []
    rep: dict[str, Leg] = {}
    for leg in legs:
        k = item_key(leg)
        if k not in rep:
            rep[k] = leg
            keys.append(k)
    n = len(keys)
    R = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            rho = stat_rho(rep[keys[i]], rep[keys[j]], priors)
            R[i, j] = R[j, i] = rho
    R = nearest_psd(R)
    index = {leg.id: (keys.index(item_key(leg)), leg.sign) for leg in legs}
    return keys, index, R


def leg_correlation(legs: Sequence[Leg], priors: dict) -> np.ndarray:
    """Signed latent correlation between legs (useful for reporting and stack discovery)."""
    keys, index, R = build_item_correlation(legs, priors)
    n = len(legs)
    out = np.eye(n)
    for i in range(n):
        ii, si = index[legs[i].id]
        for j in range(i + 1, n):
            jj, sj = index[legs[j].id]
            out[i, j] = out[j, i] = R[ii, jj] * si * sj if ii != jj else -1.0 * (si != sj) + 1.0 * (si == sj)
    return out
