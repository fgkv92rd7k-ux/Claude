"""Payout tables, breakevens and exact (independent) entry EV.

Perfect play: all n legs must hit; pays M_n.
Flex play   : pays M_{n,k} for k hits (k near n), 0 otherwise.
Promo funds : Betr Bucks style, 'stake_not_returned' -> cash credited = max(M - 1, 0) x stake.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
from scipy.optimize import brentq


@dataclass
class PayoutTable:
    perfect: dict            # {n: M}
    flex: dict               # {n: {k: M}}
    min_entry: float = 1.0
    max_entry: float = 1000.0
    stake_step: float = 0.5
    notes: list = None

    @classmethod
    def load(cls, path: str) -> "PayoutTable":
        with open(path) as fh:
            raw = json.load(fh)
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> "PayoutTable":
        perfect = {int(k): float(v) for k, v in raw.get("perfect", {}).items()}
        flex = {int(n): {int(k): float(m) for k, m in tiers.items()} for n, tiers in raw.get("flex", {}).items()}
        return cls(perfect=perfect, flex=flex,
                   min_entry=float(raw.get("min_entry", 1.0)), max_entry=float(raw.get("max_entry", 1000.0)),
                   stake_step=float(raw.get("stake_step", 0.5)), notes=raw.get("_verify", []))

    def sizes(self, mode: str) -> list[int]:
        return sorted(self.perfect if mode == "perfect" else self.flex)

    def has(self, mode: str, n: int) -> bool:
        return n in (self.perfect if mode == "perfect" else self.flex)

    def payout_vector(self, mode: str, n: int) -> np.ndarray:
        """Multiplier paid for k = 0..n hits."""
        v = np.zeros(n + 1)
        if mode == "perfect":
            v[n] = self.perfect[n]
        elif mode == "flex":
            for k, m in self.flex[n].items():
                v[k] = m
        else:
            raise ValueError(mode)
        return v


def promo_cash_vector(payout_vec: np.ndarray, rules: dict | None) -> np.ndarray:
    """Cash credited per $1 of promo stake for each hit count."""
    mode = (rules or {}).get("mode", "stake_not_returned")
    if mode == "cash":                       # promo behaves like cash (stake returned): return multiplier
        return payout_vec.copy()
    if mode == "stake_not_returned":         # Betr Bucks: one multiplier lower; nothing on a miss
        return np.maximum(payout_vec - 1.0, 0.0)
    if mode == "tier_shift":                 # generic: pay the next lower tier (approximation)
        return np.maximum(payout_vec - 1.0, 0.0)
    raise ValueError(f"unknown promo mode {mode}")


def poisson_binomial(probs: Sequence[float]) -> np.ndarray:
    """Exact distribution of the number of successes among independent Bernoulli(p_i)."""
    dist = np.array([1.0])
    for p in probs:
        new = np.zeros(len(dist) + 1)
        new[:-1] += dist * (1.0 - p)
        new[1:] += dist * p
        dist = new
    return dist


def entry_ev_independent(probs: Sequence[float], mode: str, table: PayoutTable, mult_mod: float = 1.0) -> tuple[float, np.ndarray]:
    """Net expected return per $1 assuming independent legs; also returns hit distribution."""
    n = len(probs)
    dist = poisson_binomial(probs)
    pay = table.payout_vector(mode, n) * mult_mod
    return float(dist @ pay - 1.0), dist


def breakeven_per_leg(mode: str, n: int, table: PayoutTable, mult_mod: float = 1.0) -> float:
    """Equal per-leg hit probability at which the entry has zero EV (independent legs)."""
    pay = table.payout_vector(mode, n) * mult_mod

    def ev(p):
        dist = poisson_binomial([p] * n)
        return float(dist @ pay - 1.0)

    if ev(0.999) <= 0:
        return 1.0
    return brentq(ev, 1e-6, 0.999, xtol=1e-10)


def breakeven_table(table: PayoutTable) -> list[dict]:
    rows = []
    for mode in ("perfect", "flex"):
        for n in table.sizes(mode):
            pay = table.payout_vector(mode, n)
            rows.append({"mode": mode, "n": n, "top_multiplier": float(pay[n]),
                         "tiers": {int(k): float(m) for k, m in enumerate(pay) if m > 0},
                         "breakeven_per_leg": breakeven_per_leg(mode, n, table)})
    return rows
