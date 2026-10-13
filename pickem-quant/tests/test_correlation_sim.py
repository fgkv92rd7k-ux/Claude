import json, os
import numpy as np
from pickem_quant.schema import Leg
from pickem_quant.correlation import build_item_correlation, leg_correlation, nearest_psd, load_priors
from pickem_quant.simulate import simulate


def mk(id, player, team, game, market, side, p, line=10.5):
    return Leg(id=id, player=player, team=team, game_id=game, market=market, line=line, side=side, p=p)


def test_nearest_psd():
    R = np.array([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1.0]])
    A = nearest_psd(R)
    assert np.linalg.eigvalsh(A).min() >= -1e-9
    assert np.allclose(np.diag(A), 1)


def test_signs_and_complementary_sides(root):
    pri = load_priors(os.path.join(root, "config", "correlation_priors.json"))
    legs = [mk("a_o", "QB", "BUF", "BUF@KC", "nfl_pass_yds", "over", 0.55), mk("a_u", "QB", "BUF", "BUF@KC", "nfl_pass_yds", "under", 0.45),
            mk("b_o", "WR", "BUF", "BUF@KC", "nfl_rec_yds", "over", 0.56), mk("b_u", "WR", "BUF", "BUF@KC", "nfl_rec_yds", "under", 0.44)]
    C = leg_correlation(legs, pri)
    assert C[0, 2] > 0.3 and C[0, 3] < -0.3 and C[0, 1] == -1.0
    sim = simulate(legs, pri, 20000, 1)
    H = sim.H
    assert np.all(H[:, 0] != H[:, 1]) and np.all(H[:, 2] != H[:, 3])
    emp = sim.empirical_p()
    assert np.allclose(emp, [0.55, 0.45, 0.56, 0.44], atol=0.012)
    # positively correlated latents -> joint hit above independence
    assert sim.p_all(["a_o", "b_o"]) > 0.55 * 0.56 + 0.01
    assert sim.p_all(["a_o", "b_u"]) < 0.55 * 0.44 - 0.01


def test_different_games_independent(root):
    pri = load_priors(os.path.join(root, "config", "correlation_priors.json"))
    legs = [mk("a", "A", "X", "G1", "nfl_pass_yds", "over", 0.55), mk("b", "B", "Y", "G2", "nfl_pass_yds", "over", 0.55)]
    sim = simulate(legs, pri, 60000, 3)
    assert abs(sim.p_all(["a", "b"]) - 0.55 ** 2) < 0.008
