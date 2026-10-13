import json, os
import numpy as np
from pickem_quant.marginals import fit_marginal, LineQuote


def priors(root):
    return json.load(open(os.path.join(root, "config", "sigma_priors.json")))


def test_single_quote_reproduces_book_probability(root):
    m = fit_marginal("nfl_rec_yds", [LineQuote(62.5, 0.57)], priors(root))
    assert abs(m.p_over(62.5) - 0.57) < 1e-9
    assert m.p_over(55.5) > 0.57 > m.p_over(70.5)


def test_multi_quote_recovers_parameters(root):
    from scipy.stats import norm
    mu, sd = 250.0, 60.0
    qs = [LineQuote(L, float(norm.sf(L, mu, sd))) for L in (230.5, 249.5, 270.5)]
    m = fit_marginal("nfl_pass_yds", qs, priors(root))
    assert abs(m.mu - mu) < 1.0 and abs(m.sd - sd) < 3.0


def test_poisson_fit_and_push(root):
    m = fit_marginal("nfl_receptions", [LineQuote(4.5, 0.55)], priors(root))
    assert abs(m.p_over(4.5) - 0.55) < 1e-8
    assert m.p_push(4.5) == 0.0 and m.p_push(4) > 0
    assert abs(m.p_side(4, "over") + m.p_side(4, "under") - 1.0) < 1e-12
