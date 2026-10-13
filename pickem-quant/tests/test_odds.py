import math
import pytest
from pickem_quant.odds import (american_to_decimal, decimal_to_american, american_to_implied, implied_to_american,
                               devig, fair_two_way, consensus, hold, logit, expit)


def test_round_trips():
    for a in (-110, -250, 120, 450, -101, 100):
        assert abs(decimal_to_american(american_to_decimal(a)) - a) < 1e-9
        p = american_to_implied(a)
        assert abs(implied_to_american(p) - a) < 1e-9
    assert abs(expit(logit(0.37)) - 0.37) < 1e-12


@pytest.mark.parametrize("method", ["multiplicative", "additive", "power", "shin"])
def test_devig_sums_to_one(method):
    q = [american_to_implied(-115), american_to_implied(-105)]
    p = devig(q, method)
    assert abs(sum(p) - 1) < 1e-9
    assert p[0] > p[1]
    q3 = [0.5, 0.35, 0.25]
    assert abs(sum(devig(q3, method)) - 1) < 1e-9


def test_power_and_shin_favor_longshots_vs_multiplicative():
    q = [american_to_implied(-400), american_to_implied(300)]
    m = devig(q, "multiplicative"); p = devig(q, "power"); s = devig(q, "shin")
    assert p[1] < m[1] and s[1] < m[1]           # longshot gets LESS probability once FL bias is removed


def test_fair_two_way_symmetric():
    po, pu = fair_two_way(-110, -110)
    assert abs(po - 0.5) < 1e-9 and abs(pu - 0.5) < 1e-9
    assert abs(hold([american_to_implied(-110)] * 2) - 0.0476) < 1e-3


def test_consensus_logit_weights():
    assert abs(consensus([(0.6, 1.0), (0.6, 2.0)]) - 0.6) < 1e-12
    c = consensus([(0.5, 1.0), (0.7, 3.0)])
    assert 0.6 < c < 0.7
