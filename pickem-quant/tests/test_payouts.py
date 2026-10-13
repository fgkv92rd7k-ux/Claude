import numpy as np
from pickem_quant.payouts import poisson_binomial, breakeven_per_leg, entry_ev_independent, promo_cash_vector, PayoutTable


def test_poisson_binomial_matches_binomial():
    from math import comb
    p = 0.55; n = 5
    d = poisson_binomial([p] * n)
    for k in range(n + 1):
        assert abs(d[k] - comb(n, k) * p ** k * (1 - p) ** (n - k)) < 1e-12
    assert abs(d.sum() - 1) < 1e-12


def test_perfect_breakeven_closed_form(table):
    for n, M in table.perfect.items():
        assert abs(breakeven_per_leg("perfect", n, table) - M ** (-1.0 / n)) < 1e-8


def test_flex_breakeven_is_zero_ev(table):
    for n in table.sizes("flex"):
        be = breakeven_per_leg("flex", n, table)
        ev, _ = entry_ev_independent([be] * n, "flex", table)
        assert abs(ev) < 1e-7


def test_entry_ev_and_mod(table):
    ev, dist = entry_ev_independent([0.6, 0.6], "perfect", table)
    assert abs(ev - (3 * 0.36 - 1)) < 1e-12
    ev2, _ = entry_ev_independent([0.6, 0.6], "perfect", table, mult_mod=1.1)
    assert abs(ev2 - (3.3 * 0.36 - 1)) < 1e-12


def test_promo_vector_stake_not_returned(table):
    pay = table.payout_vector("flex", 5)
    v = promo_cash_vector(pay, {"mode": "stake_not_returned"})
    assert v[5] == 9.0 and v[4] == 1.0 and v[3] == 0.0 and v[0] == 0.0
    assert np.allclose(promo_cash_vector(pay, {"mode": "cash"}), pay)
