"""Scenario-based portfolio construction over candidate entries and two bankrolls.

Assets are (entry, bankroll) pairs. Cash assets return (payout - 1) per dollar; promo assets
return the cash credited per promo dollar (>= 0, because a lost promo dollar costs no cash).
Both are evaluated on the SAME simulated scenarios, so the covariance between entries that
share legs is captured exactly (up to Monte Carlo error).

Objectives
  mvo   : maximise  mu.x - (1/2) (x*sqrt(lam))' S (x*sqrt(lam))  with lam_i = risk_aversion / cash_bankroll
          per asset. lam = 1/B is the quadratic approximation to full Kelly; 3/B ~ third-Kelly. Promo
          assets get their own (lower) aversion because their cash return is never negative, which a
          symmetric variance penalty would otherwise over-punish.
  kelly : maximise  E[log(B + R x)] on the scenarios (exact Kelly for lottery-like payoffs, where the
          quadratic MVO approximation under-bets), then scale CASH stakes by kelly_fraction. Default.
Constraints: per-bankroll slate budget, per-entry cap, per-leg exposure cap, max entries,
stake ladder (step, minimum).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
from scipy.optimize import minimize

from .payouts import PayoutTable, promo_cash_vector
from .schema import Entry
from .simulate import Simulation


@dataclass
class Allocation:
    stakes_cash: dict = field(default_factory=dict)     # entry key -> $
    stakes_promo: dict = field(default_factory=dict)
    stats: dict = field(default_factory=dict)
    objective: str = "mvo"

    def to_dict(self):
        return {"objective": self.objective, "stakes_cash": self.stakes_cash, "stakes_promo": self.stakes_promo, "stats": self.stats}


def compress_scenarios(entries: Sequence[Entry], sim: Simulation) -> tuple[np.ndarray, np.ndarray, dict]:
    """Collapse the simulation to the distinct hit patterns over the legs the entries use.

    Entry returns depend only on which of those legs hit, so identical patterns can be merged with a
    weight equal to their frequency: the objective is unchanged and the optimizer runs on at most
    2^L rows instead of S scenarios (for L=12 legs that is ~2,000 rows versus 40,000).
    """
    used = sorted({l for e in entries for l in e.legs})
    pos = {l: i for i, l in enumerate(used)}
    H = sim.H[:, sim.idx(used)]
    packed = np.packbits(H, axis=1)
    _, inv, counts = np.unique(packed, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    first = np.zeros(len(counts), dtype=np.int64)
    first[inv[::-1]] = np.arange(H.shape[0] - 1, -1, -1)
    H_u = H[first]
    w = counts / H.shape[0]
    return H_u, w, pos


def return_matrices(entries: Sequence[Entry], sim: Simulation, table: PayoutTable, promo_rules: dict | None,
                    H: np.ndarray | None = None, pos: dict | None = None):
    """Per-scenario returns per $1 for cash (payout-1) and promo (cash credited) assets."""
    if H is None:
        H = sim.H
        pos = sim.leg_pos
    S, N = H.shape[0], len(entries)
    R_cash = np.zeros((S, N))
    R_promo = np.zeros((S, N))
    for j, e in enumerate(entries):
        hits = H[:, [pos[l] for l in e.legs]].sum(axis=1)
        pay = table.payout_vector(e.mode, e.n) * e.multiplier_mod
        R_cash[:, j] = pay[hits] - 1.0
        R_promo[:, j] = promo_cash_vector(pay, promo_rules)[hits]
    return R_cash, R_promo


def leg_membership(entries: Sequence[Entry]) -> tuple[list[str], np.ndarray]:
    legs = sorted({l for e in entries for l in e.legs})
    pos = {l: i for i, l in enumerate(legs)}
    M = np.zeros((len(legs), len(entries)))
    for j, e in enumerate(entries):
        for l in e.legs:
            M[pos[l], j] = 1.0
    return legs, M


def _round_ladder(x: np.ndarray, step: float, min_stake: float, round_up_threshold: float = 0.6) -> np.ndarray:
    """Round to the stake ladder. Stakes below the minimum are dropped unless they are at least
    round_up_threshold x min_stake, in which case they become the minimum (tiny bankrolls would
    otherwise never place anything)."""
    y = np.round(x / step) * step
    small = (y < min_stake) & (x >= round_up_threshold * min_stake)
    y[small] = min_stake
    y[y < min_stake] = 0.0
    return y


def _repair(x: np.ndarray, A_ub: np.ndarray, b_ub: np.ndarray, step: float) -> np.ndarray:
    """Rounding can push a linear constraint (budget or leg cap) slightly over: trim the smallest
    stake among the row's members one step at a time until every row is satisfied."""
    for _ in range(10000):
        viol = A_ub @ x - b_ub
        i = int(np.argmax(viol))
        if viol[i] <= 1e-9:
            break
        members = np.where((A_ub[i] > 0) & (x > 0))[0]
        if len(members) == 0:
            break
        j = members[np.argmin(x[members])]
        x[j] = max(0.0, x[j] - step)
    return x


def _solve(objective: str, R: np.ndarray, x0: np.ndarray, ub: np.ndarray, A_ub: np.ndarray, b_ub: np.ndarray,
           lam: np.ndarray, B: float, mu: np.ndarray, Sigma: np.ndarray, w: np.ndarray | None = None) -> np.ndarray:
    n = len(x0)
    if w is None:
        w = np.full(R.shape[0], 1.0 / R.shape[0])
    if objective == "mvo":
        # per-asset risk weights: penalty = 0.5 * (x*sqrt(lam))' Sigma (x*sqrt(lam))
        sl = np.sqrt(lam)
        f = lambda x: -(mu @ x - 0.5 * (x * sl) @ Sigma @ (x * sl))
        g = lambda x: -(mu - sl * (Sigma @ (x * sl)))
    elif objective == "kelly":
        def f(x):
            wealth = B + R @ x
            if np.any(wealth <= 1e-9):
                return 1e6
            return -float(w @ np.log(wealth))

        def g(x):
            wealth = B + R @ x
            if np.any(wealth <= 1e-9):
                return np.zeros(n)
            return -(R.T @ (w / wealth))
    else:
        raise ValueError(objective)
    cons = [{"type": "ineq", "fun": lambda x, A=A_ub, b=b_ub: b - A @ x, "jac": lambda x, A=A_ub: -A}]
    bounds = [(0.0, float(u)) for u in ub]
    res = minimize(f, x0, jac=g, bounds=bounds, constraints=cons, method="SLSQP",
                   options={"maxiter": 500, "ftol": 1e-12})
    x = np.clip(res.x, 0.0, ub)
    # feasibility repair for tiny constraint violations from SLSQP
    viol = A_ub @ x - b_ub
    if np.any(viol > 1e-9):
        for i in np.where(viol > 1e-9)[0]:
            row = A_ub[i]
            mass = row @ x
            if mass > 0:
                x = x * np.where(row > 0, b_ub[i] / mass, 1.0)
    return x


def optimize(entries: Sequence[Entry], sim: Simulation, table: PayoutTable, cfg: dict,
             budgets: dict, cash_bankroll: float, promo_rules: dict | None = None,
             objective: str | None = None) -> Allocation:
    pcfg = cfg.get("portfolio", {})
    objective = objective or pcfg.get("objective", "mvo")
    entries = list(entries)
    N = len(entries)
    if N == 0:
        return Allocation(stats={"note": "no candidate entries"}, objective=objective)

    H_u, w, pos = compress_scenarios(entries, sim)
    R_cash, R_promo = return_matrices(entries, sim, table, promo_rules, H_u, pos)
    R = np.hstack([R_cash, R_promo])                           # patterns x 2N
    mu = w @ R
    Rc = R - mu
    Sigma = Rc.T @ (Rc * w[:, None]) + 1e-10 * np.eye(2 * N)
    B = max(float(cash_bankroll), 1e-6)
    lam_cash = float(pcfg.get("risk_aversion_kelly_units", 3.0)) / B
    lam_promo = float(pcfg.get("promo_risk_aversion_kelly_units", pcfg.get("risk_aversion_kelly_units", 3.0))) / B
    lam = np.concatenate([np.full(N, lam_cash), np.full(N, lam_promo)])

    legs, M = leg_membership(entries)
    rows, rhs = [], []
    ub = np.zeros(2 * N)
    budget = {"cash": float(budgets.get("cash", 0.0)), "promo": float(budgets.get("promo", 0.0))}
    for bi, bk in enumerate(("cash", "promo")):
        bcfg = pcfg.get(bk, {})
        sl = slice(bi * N, (bi + 1) * N)
        if budget[bk] <= 0:
            continue
        row = np.zeros(2 * N); row[sl] = 1.0
        rows.append(row); rhs.append(budget[bk])
        ub[sl] = min(budget[bk] * float(bcfg.get("max_stake_pct_of_budget", 0.5)), table.max_entry)
        cap = budget[bk] * float(bcfg.get("max_leg_exposure_pct_of_budget", 0.6))
        for li in range(len(legs)):
            row = np.zeros(2 * N); row[sl] = M[li]
            rows.append(row); rhs.append(cap)
    A_ub = np.array(rows) if rows else np.zeros((1, 2 * N))
    b_ub = np.array(rhs) if rhs else np.array([1.0])
    # promo assets cannot lose cash, so a promo asset with no cash return is simply never funded
    if budget["promo"] <= 0:
        ub[N:] = 0.0
    if budget["cash"] <= 0:
        ub[:N] = 0.0

    frac = np.ones(2 * N)
    if objective == "kelly":
        # fractional Kelly on cash only: promo stakes cannot lose cash, so scaling them down just slows conversion
        frac[:N] = float(pcfg.get("kelly_fraction", 0.33))
    step = float(pcfg.get("stake_step", table.stake_step))
    min_stake = max(float(pcfg.get("min_stake", table.min_entry)), table.min_entry)
    thr = float(pcfg.get("min_stake_round_up_threshold", 0.6)) * min_stake
    max_entries = {bk: int(pcfg.get(bk, {}).get("max_entries", 8)) for bk in ("cash", "promo")}

    # Minimum-lot / cardinality heuristic: solve, drop the smallest sub-minimum stakes (and any beyond the
    # entry limit), re-solve, until every funded entry is at least the minimum stake.
    x = np.zeros(2 * N)
    for _ in range(80):
        x = _solve(objective, R, x, ub, A_ub, b_ub, lam, B, mu, Sigma, w) * frac
        drop: list[int] = []
        for bi, bk in enumerate(("cash", "promo")):
            off = bi * N
            seg = x[off:off + N]
            nz = np.where(seg > 1e-9)[0]
            if len(nz) > max_entries[bk]:
                order = nz[np.argsort(seg[nz])]
                drop += [off + j for j in order[: len(nz) - max_entries[bk]]]
            small = sorted((j for j in nz if seg[j] < thr), key=lambda j: seg[j])
            drop += [off + j for j in small[: max(1, len(small) // 2)]] if small else []
        if not drop:
            break
        ub[sorted(set(drop))] = 0.0
        x[sorted(set(drop))] = 0.0
    x = _round_ladder(x, step, min_stake, thr / min_stake)
    x = _repair(x, A_ub, b_ub, step)

    stakes_cash = {entries[j].key: float(x[j]) for j in range(N) if x[j] > 0}
    stakes_promo = {entries[j].key: float(x[N + j]) for j in range(N) if x[N + j] > 0}
    stats = evaluate(x, R_cash, R_promo, entries, legs, M, budget, B, w)
    stats["lambda"] = lam_cash
    stats["lambda_promo"] = lam_promo
    return Allocation(stakes_cash=stakes_cash, stakes_promo=stakes_promo, stats=stats, objective=objective)


def _wquantile(v: np.ndarray, w: np.ndarray, q: float) -> float:
    order = np.argsort(v)
    cw = np.cumsum(w[order])
    return float(v[order][min(int(np.searchsorted(cw, q * cw[-1])), len(v) - 1)])


def evaluate(x: np.ndarray, R_cash: np.ndarray, R_promo: np.ndarray, entries: Sequence[Entry],
             legs: list[str], M: np.ndarray, budget: dict, B: float, w: np.ndarray | None = None) -> dict:
    N = len(entries)
    if w is None:
        w = np.full(R_cash.shape[0], 1.0 / R_cash.shape[0])
    xc, xp = x[:N], x[N:]
    pnl_cash = R_cash @ xc
    cash_from_promo = R_promo @ xp
    pnl = pnl_cash + cash_from_promo
    mean = float(w @ pnl)
    sd = float(np.sqrt(max(w @ (pnl - mean) ** 2, 0.0)))
    spent_c, spent_p = float(xc.sum()), float(xp.sum())
    out = {
        "cash_staked": spent_c, "promo_staked": spent_p,
        "cash_budget": budget["cash"], "promo_budget": budget["promo"],
        "ev_cash_entries": float(w @ pnl_cash),
        "ev_cash_from_promo": float(w @ cash_from_promo),
        "promo_conversion_rate": float((w @ cash_from_promo) / spent_p) if spent_p > 0 else None,
        "ev_total": mean, "sd_total": sd,
        "p_total_negative": float(w @ (pnl < 0)),
        "p_lose_all_cash_stakes": float(w @ (pnl_cash <= -spent_c + 1e-9)) if spent_c > 0 else None,
        "p_lose_half_cash_bankroll": float(w @ (pnl < -0.5 * B)),
        "quantiles": {k: _wquantile(pnl, w, q) for k, q in (("p05", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95))},
        "max_loss": float(pnl.min()), "max_gain": float(pnl.max()),
        "n_entries_cash": int(np.count_nonzero(xc)), "n_entries_promo": int(np.count_nonzero(xp)),
        "sharpe_per_slate": float(mean / sd) if sd > 0 else None,
    }
    exp_c = M @ xc
    exp_p = M @ xp
    out["leg_exposure"] = {legs[i]: {"cash": float(exp_c[i]), "promo": float(exp_p[i])} for i in range(len(legs)) if exp_c[i] + exp_p[i] > 0}
    return out
