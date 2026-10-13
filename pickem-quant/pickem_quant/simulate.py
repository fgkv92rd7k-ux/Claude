"""Monte Carlo of leg outcomes through a Gaussian copula with common random numbers."""
from __future__ import annotations

from typing import Sequence

import numpy as np
from scipy.stats import norm

from .schema import Leg
from .correlation import build_item_correlation


class Simulation:
    """Holds a (scenarios x legs) boolean hit matrix H and the ids/order of legs."""

    def __init__(self, legs: Sequence[Leg], H: np.ndarray, R_items: np.ndarray, item_keys: list[str]):
        self.legs = list(legs)
        self.H = H
        self.R_items = R_items
        self.item_keys = item_keys
        self.leg_pos = {leg.id: i for i, leg in enumerate(self.legs)}
        self.S = H.shape[0]

    def idx(self, leg_ids: Sequence[str]) -> np.ndarray:
        return np.fromiter((self.leg_pos[i] for i in leg_ids), dtype=np.int64, count=len(leg_ids))

    def hits(self, leg_ids: Sequence[str]) -> np.ndarray:
        """Number of hits per scenario for a set of legs."""
        return self.H[:, self.idx(leg_ids)].sum(axis=1)

    def p_all(self, leg_ids: Sequence[str]) -> float:
        return float(self.H[:, self.idx(leg_ids)].all(axis=1).mean())

    def hit_distribution(self, leg_ids: Sequence[str]) -> np.ndarray:
        n = len(leg_ids)
        return np.bincount(self.hits(leg_ids), minlength=n + 1)[: n + 1] / self.S

    def empirical_p(self) -> np.ndarray:
        return self.H.mean(axis=0)


def simulate(legs: Sequence[Leg], priors: dict, scenarios: int = 40000, seed: int = 7) -> Simulation:
    legs = list(legs)
    item_keys, index, R = build_item_correlation(legs, priors)
    n_items = len(item_keys)
    rng = np.random.default_rng(seed)
    L = np.linalg.cholesky(R + 1e-10 * np.eye(n_items))
    Z = rng.standard_normal((scenarios, n_items)) @ L.T
    U = norm.cdf(Z)                                   # uniforms with the latent dependence
    # p_over per item: take it from the over leg if present, else 1 - p_under
    p_over = np.full(n_items, np.nan)
    for leg in legs:
        ii, s = index[leg.id]
        p_over[ii] = leg.p if s == 1 else 1.0 - leg.p
    H = np.zeros((scenarios, len(legs)), dtype=bool)
    for j, leg in enumerate(legs):
        ii, s = index[leg.id]
        over_hit = U[:, ii] < p_over[ii]
        H[:, j] = over_hit if s == 1 else ~over_hit
    return Simulation(legs, H, R, item_keys)
