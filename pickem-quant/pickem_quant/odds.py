"""Odds conversion and vig removal.

Everything here is pure functions on floats. Methods:
  multiplicative : p_i = q_i / sum(q)                     (classic, biased on longshots)
  additive       : p_i = q_i - (sum(q) - 1) / n
  power          : p_i = q_i ** k with sum(p) = 1          (favourite-longshot aware; default)
  shin           : Shin (1993) insider-trading model       (favourite-longshot aware)
Two-way player props have a small hold (3-8%), so the methods agree closely; power/shin matter
more for lopsided prices (alt lines) which we also use when fitting marginals.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

from scipy.optimize import brentq


def american_to_decimal(a: float) -> float:
    a = float(a)
    if a == 0:
        raise ValueError("American odds cannot be 0")
    return 1.0 + a / 100.0 if a > 0 else 1.0 + 100.0 / abs(a)


def decimal_to_american(d: float) -> float:
    if d <= 1.0:
        raise ValueError("decimal odds must exceed 1.0")
    return (d - 1.0) * 100.0 if d >= 2.0 else -100.0 / (d - 1.0)


def american_to_implied(a: float) -> float:
    return 1.0 / american_to_decimal(a)


def implied_to_american(p: float) -> float:
    if not 0.0 < p < 1.0:
        raise ValueError("probability must be in (0,1)")
    return decimal_to_american(1.0 / p)


def logit(p: float) -> float:
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1.0 - p))


def expit(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def hold(implieds: Iterable[float]) -> float:
    return sum(implieds) - 1.0


def devig(implieds: Sequence[float], method: str = "power") -> list[float]:
    q = [float(x) for x in implieds]
    if any(x <= 0 for x in q):
        raise ValueError("implied probabilities must be positive")
    s = sum(q)
    n = len(q)
    if n < 2:
        raise ValueError("need at least two outcomes to devig")
    if abs(s - 1.0) < 1e-12:
        return q
    method = method.lower()
    if method == "multiplicative":
        return [x / s for x in q]
    if method == "additive":
        p = [x - (s - 1.0) / n for x in q]
        if min(p) <= 0:            # fall back when a longshot would go negative
            return [x / s for x in q]
        return p
    if method == "power":
        if s < 1.0:                # arbitrage-able quote; power exponent < 1
            lo, hi = 0.05, 1.0
        else:
            lo, hi = 1.0, 50.0
        f = lambda k: sum(x ** k for x in q) - 1.0
        k = brentq(f, lo, hi, xtol=1e-12, maxiter=200)
        return [x ** k for x in q]
    if method == "shin":
        if s <= 1.0:
            return [x / s for x in q]

        def probs(z):
            return [(math.sqrt(z * z + 4.0 * (1.0 - z) * x * x / s) - z) / (2.0 * (1.0 - z)) for x in q]

        f = lambda z: sum(probs(z)) - 1.0
        try:
            z = brentq(f, 0.0, 0.999, xtol=1e-12, maxiter=200)
        except ValueError:
            return [x / s for x in q]
        return probs(z)
    raise ValueError(f"unknown devig method: {method}")


def fair_two_way(price_over: float, price_under: float, method: str = "power") -> tuple[float, float]:
    """Fair (vig-free) probabilities for a two-way quote given American prices."""
    qo, qu = american_to_implied(price_over), american_to_implied(price_under)
    po, pu = devig([qo, qu], method)
    return po, pu


def consensus_logit(probs_and_weights: Sequence[tuple[float, float]]) -> float:
    """Weighted mean in logit space (robust to the asymmetric scale of probabilities)."""
    num = sum(w * logit(p) for p, w in probs_and_weights)
    den = sum(w for _, w in probs_and_weights)
    if den <= 0:
        raise ValueError("weights must sum to a positive number")
    return num / den


def consensus(probs_and_weights: Sequence[tuple[float, float]]) -> float:
    return expit(consensus_logit(probs_and_weights))
