import json, os, sys
import numpy as np
from pickem_quant.ledger import plan_records, settle, metrics
from pickem_quant.portfolio import Allocation
from pickem_quant.schema import Entry, Leg
from pickem_quant.bankroll import State, slate_budgets, apply_settlement, check_kill_switch
from datetime import date


def test_ledger_roundtrip_and_metrics(table):
    legs = {f"l{i}": Leg(id=f"l{i}", player=f"P{i}", team="T", game_id=f"G{i}", market="nba_points", line=20.5, side="over", p=0.6, book_line=20.5, book_p_over=0.58) for i in range(3)}
    e = Entry(legs=("l0", "l1", "l2"), mode="flex", n=3, p_all=0.2, ev_cash=0.1, ev_promo=0.5)
    alloc = Allocation(stakes_cash={e.key: 10.0}, stakes_promo={e.key: 5.0})
    recs = plan_records("s1", alloc, {e.key: e}, legs)
    assert len(recs) == 2 and all(r["status"] == "open" for r in recs)
    recs = settle(recs, {"l0": "hit", "l1": "hit", "l2": "miss"}, {"l0": 0.62, "l1": 0.6, "l2": 0.55}, table, {"mode": "stake_not_returned"})
    cash = next(r for r in recs if r["bankroll"] == "cash"); promo = next(r for r in recs if r["bankroll"] == "promo")
    assert cash["payout_mult"] == 1.25 and abs(cash["pnl"] - 2.5) < 1e-9
    assert promo["cash_credited"] == 1.25 and promo["pnl"] == 1.25        # (1.25 - 1) x 5
    m = metrics(recs)
    assert m["cash"]["pnl"] == 2.5 and m["legs"]["n"] == 6 and m["n_legs_with_close"] == 6
    assert m["clv_logit_mean"] < 0                                         # closes moved against us on average
    # push collapses a 3-leg to 2 legs -> perfect 2 table applies for a perfect entry
    e2 = Entry(legs=("l0", "l1", "l2"), mode="perfect", n=3)
    recs2 = plan_records("s2", Allocation(stakes_cash={e2.key: 4.0}), {e2.key: e2}, legs)
    recs2 = settle(recs2, {"l0": "hit", "l1": "push", "l2": "hit"}, None, table, None)
    assert recs2[0]["payout_mult"] == 3.0 and recs2[0]["n_live"] == 2


def test_bankroll_budgets_and_kill_switch(cfg):
    st = State(cash=100, promo=125, promo_expires="2026-11-05", peak_cash=100)
    b = slate_budgets(st, cfg, date(2026, 10, 18))
    assert b["cash"] == 25.0 and b["promo"] == 25.0
    b2 = slate_budgets(st, cfg, date(2026, 11, 4))
    assert b2["promo"] == 125.0
    st = apply_settlement(st, -50.0, 25.0, 10.0)
    assert st.cash == 60.0 and st.promo == 100.0
    b3 = slate_budgets(st, cfg, date(2026, 10, 20))
    assert b3["cash"] == 7.5 and any("halved" in n for n in b3["notes"])
    st = check_kill_switch(st, {"rolling_clv_logit": -0.05, "n_legs_with_close": 200}, cfg)
    assert st.halted


def test_cli_demo_runs(tmp_path, root):
    from pickem_quant.cli import main
    out = tmp_path / "demo"
    main(["demo", "--out", str(out), "--state", str(tmp_path / "state.json"), "--ledger", str(tmp_path / "ledger.jsonl"), "--record"])
    res = json.load(open(out / "result.json"))
    assert res["plan"], "demo slate should produce a stake plan"
    assert (tmp_path / "ledger.jsonl").exists()
    assert not any("stalebook" in str(d.get("books")) for d in [] )
    # the stale quote must not be among the books used for Jayden Reed
    reed = [l for l in res["legs_all"] if l["player"] == "Jayden Reed"]
    assert reed and all(l["n_books"] == 1 for l in reed)
