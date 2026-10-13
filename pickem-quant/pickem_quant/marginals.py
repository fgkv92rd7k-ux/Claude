"""Marginal outcome models used to move a probability from the book's line to the Betr line.

A sportsbook quote gives P(X > L_book). The pick'em board asks about P(X > L_betr), often a
different number. We fit a simple parametric distribution for the player's stat X:

  normal  : X ~ N(mu, sd); one quote fixes mu given an sd prior (config/sigma_priors.json);
            two or more quotes (alt lines) fit mu and sd by least squares in probability space.
  poisson : X ~ Poisson(lam); for small counts (receptions, 3PM, hits, TDs).

Lines ending in .5 are evaluated as P(X >= ceil(L)); integer lines carry push mass P(X == L),
which pick'em sites usually void (we then condition on no push).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
from scipy.optimize import brentq, minimize
from scipy.stats import norm, poisson


@dataclass
class LineQuote:
    line: float
    p_over: float           # fair probability of the over at `line`
    weight: float = 1.0


@dataclass
class Marginal:
    family: str
    mu: float
    sd: float = 0.0       # normal only

    # --- probabilities -----------------------------------------------------------------
    def p_over(self, line: float) -> float:
        if self.family == "normal":
            return float(norm.sf(line, loc=self.mu, scale=self.sd))
        if self.family == "poisson":
            # P(X > line) = P(X >= floor(line)+1)
            k = math.floor(line) + 1
            return float(poisson.sf(k - 1, self.mu))
        raise ValueError(self.family)

    def p_push(self, line: float) -> float:
        if self.family == "poisson" and float(line).is_integer():
            return float(poisson.pmf(int(line), self.mu))
        return 0.0

    def p_under(self, line: float) -> float:
        return max(0.0, 1.0 - self.p_over(line) - self.p_push(line))

    def p_side(self, line: float, side: str, condition_no_push: bool = True) -> float:
        po, pu, pp = self.p_over(line), self.p_under(line), self.p_push(line)
        if condition_no_push and pp > 0:
            po, pu = po / (1 - pp), pu / (1 - pp)
        return po if side == "over" else pu

    def to_dict(self):
        return {"family": self.family, "mu": self.mu, "sd": self.sd}


def sd_prior(market: str, line: float, priors: dict) -> tuple[str, float]:
    spec = priors.get("markets", {}).get(market) or priors.get("default", {"family": "normal", "a": 0.35, "b": 2.0, "min_sd": 1.0})
    family = spec.get("family", "normal")
    if family == "poisson":
        return family, 0.0
    sd = spec.get("a", 0.35) * abs(line) + spec.get("b", 2.0)
    return family, max(sd, spec.get("min_sd", 1.0))


def fit_marginal(market: str, quotes: Sequence[LineQuote], priors: dict) -> Marginal:
    """Fit a marginal from one or more fair (devigged) line quotes.

    One quote: the distribution's location is solved exactly; scale comes from the prior.
    Several quotes: location and scale solved by weighted least squares on probabilities,
    regularised gently toward the prior scale so a noisy alt line cannot blow up sd.
    """
    if not quotes:
        raise ValueError("need at least one quote")
    family, sd0 = sd_prior(market, quotes[0].line, priors)
    qs = [q for q in quotes if 0.0 < q.p_over < 1.0]
    if not qs:
        raise ValueError("quotes must have p_over strictly inside (0,1)")

    if family == "poisson":
        if len(qs) == 1:
            q = qs[0]
            k = math.floor(q.line) + 1
            f = lambda lam: poisson.sf(k - 1, lam) - q.p_over
            lam = brentq(f, 1e-6, max(50.0, 10 * q.line + 10), xtol=1e-10)
            return Marginal("poisson", float(lam))
        def loss(x):
            lam = math.exp(x[0])
            return sum(q.weight * (poisson.sf(math.floor(q.line), lam) - q.p_over) ** 2 for q in qs)
        res = minimize(loss, x0=[math.log(max(qs[0].line, 0.5))], method="Nelder-Mead")
        return Marginal("poisson", math.exp(res.x[0]))

    # normal
    if len(qs) == 1:
        q = qs[0]
        mu = float(q.line + sd0 * norm.ppf(q.p_over))
        return Marginal("normal", mu, float(sd0))

    lines = np.array([q.line for q in qs])
    ps = np.array([q.p_over for q in qs])
    ws = np.array([q.weight for q in qs])
    mu0 = float(lines[np.argmin(np.abs(ps - 0.5))])

    def loss(x):
        mu, log_sd = x
        sd = math.exp(log_sd)
        pred = norm.sf(lines, loc=mu, scale=sd)
        fit = float(np.sum(ws * (pred - ps) ** 2))
        reg = 0.02 * (log_sd - math.log(sd0)) ** 2          # mild shrinkage toward prior scale
        return fit + reg

    res = minimize(loss, x0=[mu0, math.log(sd0)], method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-10, "maxiter": 2000})
    mu, sd = float(res.x[0]), float(math.exp(res.x[1]))
    return Marginal("normal", mu, sd)
