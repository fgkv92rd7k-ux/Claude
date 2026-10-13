"""Command line: pq run | breakeven | settle | report | demo | fetch-odds | parse-board | overlay | calibrate"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from . import __version__
from .bankroll import State, load_state, save_state, slate_budgets, apply_settlement, check_kill_switch
from .engine import run_slate
from .io import load_board, load_quotes, load_config, load_json
from .ledger import read as ledger_read, write_all, append, plan_records, settle as ledger_settle, metrics as ledger_metrics
from .payouts import PayoutTable, breakeven_table
from .report import render
from .schema import Leg, Entry

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _cfg(args) -> dict:
    path = args.config or os.path.join(ROOT, "config", "default.json")
    cfg = load_config(path)
    if getattr(args, "cash", None) is not None:
        cfg["bankrolls"]["cash"]["balance"] = float(args.cash)
    if getattr(args, "promo", None) is not None:
        cfg["bankrolls"]["promo"]["balance"] = float(args.promo)
    return cfg


def _now(args) -> datetime | None:
    if getattr(args, "now", None):
        return datetime.fromisoformat(args.now.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def cmd_breakeven(args):
    cfg = _cfg(args)
    table = PayoutTable.load(cfg["payout_table"])
    print(f"{'mode':8s} {'n':>2s} {'top':>6s} {'breakeven':>10s}  tiers")
    for r in breakeven_table(table):
        print(f"{r['mode']:8s} {r['n']:>2d} {r['top_multiplier']:>6g} {r['breakeven_per_leg']:>10.4f}  {r['tiers']}")
    for n in table.notes or []:
        print("verify:", n)


def cmd_run(args):
    cfg = _cfg(args)
    slate_id, board = load_board(args.board)
    slate_id = args.slate_id or slate_id
    quotes = load_quotes(args.odds)
    state_path = args.state or os.path.join(ROOT, cfg.get("state_path", "state.json"))
    state = load_state(state_path, cfg)
    if args.cash is not None:
        state.cash = float(args.cash); state.peak_cash = max(state.peak_cash, state.cash)
    if args.promo is not None:
        state.promo = float(args.promo)
    if args.promo_expires:
        state.promo_expires = args.promo_expires
    overlay = load_json(args.overlay) if args.overlay else None
    now = _now(args)
    budgets = None
    if args.cash_budget is not None or args.promo_budget is not None:
        budgets = slate_budgets(state, cfg, now.date())
        if args.cash_budget is not None:
            budgets["cash"] = float(args.cash_budget)
        if args.promo_budget is not None:
            budgets["promo"] = float(args.promo_budget)
    res = run_slate(board, quotes, cfg, slate_id, now=now, state=state, objective=args.objective, overlay=overlay, budgets=budgets)
    out_dir = args.out or os.path.join(ROOT, "out", slate_id)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "result.json"), "w") as fh:
        json.dump(res, fh, indent=2, default=float)
    md = render(res)
    with open(os.path.join(out_dir, "plan.md"), "w") as fh:
        fh.write(md)
    print(md)
    print(f"\n[written] {out_dir}/plan.md and result.json")
    if args.record and res.get("plan"):
        from .portfolio import Allocation
        alloc = Allocation(stakes_cash=res["allocation"]["stakes_cash"], stakes_promo=res["allocation"]["stakes_promo"])
        entries = {e["key"]: Entry(legs=tuple(e["legs"]), mode=e["mode"], n=e["n"], multiplier_mod=e["multiplier_mod"],
                                   p_all=e["p_all"], ev_cash=e["ev_cash"], ev_cash_indep=e.get("ev_cash_indep", 0.0),
                                   ev_promo=e["ev_promo"], key=e["key"]) for e in res["candidates"]}
        legs = {l["id"]: Leg(**{k: v for k, v in l.items()}) for l in res["legs_selected"]}
        recs = plan_records(slate_id, alloc, entries, legs, res["generated"])
        ledger_path = args.ledger or os.path.join(ROOT, cfg.get("ledger_path", "ledger.jsonl"))
        append(ledger_path, recs)
        save_state(state_path, state)
        print(f"[recorded] {len(recs)} entries to {ledger_path}. Settle with: pq settle --results results.json")


def cmd_settle(args):
    cfg = _cfg(args)
    table = PayoutTable.load(cfg["payout_table"])
    ledger_path = args.ledger or os.path.join(ROOT, cfg.get("ledger_path", "ledger.jsonl"))
    state_path = args.state or os.path.join(ROOT, cfg.get("state_path", "state.json"))
    recs = ledger_read(ledger_path)
    results = load_json(args.results)
    closing = load_json(args.closing) if args.closing else None
    before = {r["id"]: dict(r) for r in recs}
    recs = ledger_settle(recs, results, closing, table, cfg["bankrolls"]["promo"].get("rules"))
    write_all(ledger_path, recs)
    st = load_state(state_path, cfg)
    cash_pnl = promo_spent = cash_from_promo = 0.0
    newly = [r for r in recs if r["status"] == "settled" and before[r["id"]]["status"] == "open"]
    for r in newly:
        if r["bankroll"] == "cash":
            cash_pnl += r["pnl"]
        else:
            promo_spent += r["stake"]; cash_from_promo += r["cash_credited"]
    st = apply_settlement(st, cash_pnl, promo_spent, cash_from_promo)
    m = ledger_metrics(recs, int(cfg.get("risk", {}).get("clv_kill_switch_window", 150)))
    st = check_kill_switch(st, m, cfg)
    save_state(state_path, st)
    print(f"settled {len(newly)} entries: cash P&L {cash_pnl:+.2f}, promo spent {promo_spent:.2f}, cash from promo {cash_from_promo:+.2f}")
    print(f"state: cash {st.cash:.2f}, promo {st.promo:.2f}, drawdown {max(0, 1 - st.cash / max(st.peak_cash, 1e-9)):.1%}" + (f"  HALTED: {st.halt_reason}" if st.halted else ""))


def cmd_report(args):
    cfg = _cfg(args)
    ledger_path = args.ledger or os.path.join(ROOT, cfg.get("ledger_path", "ledger.jsonl"))
    recs = ledger_read(ledger_path)
    m = ledger_metrics(recs, int(cfg.get("risk", {}).get("clv_kill_switch_window", 150)))
    print(json.dumps(m, indent=2))


def cmd_demo(args):
    args.board = os.path.join(ROOT, "examples", "board.sample.json")
    args.odds = os.path.join(ROOT, "examples", "odds.sample.json")
    args.slate_id = args.slate_id or "demo"
    args.now = args.now or "2026-10-18T16:00:00Z"
    args.out = args.out or os.path.join(ROOT, "out", "demo")
    args.state = args.state or os.path.join(ROOT, "out", "demo", "state.json")
    args.ledger = args.ledger or os.path.join(ROOT, "out", "demo", "ledger.jsonl")
    os.makedirs(os.path.dirname(args.state), exist_ok=True)
    if os.path.exists(args.state):
        os.remove(args.state)
    cmd_run(args)


def cmd_fetch_odds(args):
    from .providers.the_odds_api import fetch_player_props
    quotes = fetch_player_props(sport=args.sport, markets=args.markets.split(","), regions=args.regions,
                                api_key=args.api_key or os.environ.get("ODDS_API_KEY"), event_ids=args.events.split(",") if args.events else None)
    with open(args.out, "w") as fh:
        json.dump({"quotes": [q.to_dict() for q in quotes]}, fh, indent=2)
    print(f"wrote {len(quotes)} quotes to {args.out}")


def cmd_parse_board(args):
    from .llm.board_parser import parse_board_text
    text = open(args.text).read()
    items = parse_board_text(text, provider=args.provider, model=args.model, sport_hint=args.sport)
    with open(args.out, "w") as fh:
        json.dump({"slate_id": args.slate_id or "parsed", "items": items}, fh, indent=2)
    print(f"wrote {len(items)} board items to {args.out}")


def cmd_overlay(args):
    from .llm.overlay import request_overlay
    res = load_json(args.result)
    news = open(args.news).read()
    ov = request_overlay(res["legs_all"], news, provider=args.provider, model=args.model,
                         cap=float(_cfg(args).get("overlay", {}).get("max_abs_logit_shift", 0.25)))
    with open(args.out, "w") as fh:
        json.dump(ov, fh, indent=2)
    print(f"wrote overlay with {len(ov.get('adjustments', []))} adjustments to {args.out}; re-run `pq run --overlay {args.out}`")


def cmd_calibrate(args):
    """Refit per-market normal sd from settled legs that carry actual stat values (optional 'actual' field)."""
    cfg = _cfg(args)
    ledger_path = args.ledger or os.path.join(ROOT, cfg.get("ledger_path", "ledger.jsonl"))
    recs = ledger_read(ledger_path)
    import numpy as np
    by_m = {}
    for r in recs:
        for l in r["legs"]:
            if l.get("actual") is not None and l.get("book_line") is not None:
                by_m.setdefault(l["market"], []).append((l["book_line"], float(l["actual"])))
    if not by_m:
        print("no settled legs with an 'actual' value; add actual stat values to ledger legs to calibrate sigma priors")
        return
    for m, pairs in by_m.items():
        arr = np.array(pairs)
        resid = arr[:, 1] - arr[:, 0]
        print(f"{m}: n={len(arr)} mean(actual-line)={resid.mean():+.2f} sd={resid.std(ddof=1):.2f} (compare with sigma_priors a*line+b at mean line {arr[:,0].mean():.1f})")


def main(argv=None):
    p = argparse.ArgumentParser(prog="pq", description=f"pickem-quant {__version__}")
    p.add_argument("--config", help="config JSON (default config/default.json)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("breakeven", help="print payout tiers and per-leg breakevens"); s.set_defaults(fn=cmd_breakeven)

    def add_run_args(s):
        s.add_argument("--board", help="board JSON/CSV (Betr lines)")
        s.add_argument("--odds", help="sportsbook quotes JSON/CSV")
        s.add_argument("--slate-id"); s.add_argument("--out"); s.add_argument("--state"); s.add_argument("--ledger")
        s.add_argument("--cash", type=float, help="override cash balance"); s.add_argument("--promo", type=float, help="override promo balance")
        s.add_argument("--promo-expires", help="ISO date the promo balance expires")
        s.add_argument("--cash-budget", type=float, help="override this slate's cash budget")
        s.add_argument("--promo-budget", type=float, help="override this slate's promo budget")
        s.add_argument("--objective", choices=["mvo", "kelly"]); s.add_argument("--overlay", help="overlay JSON from `pq overlay`")
        s.add_argument("--now", help="ISO timestamp for quote staleness checks (default: now)")
        s.add_argument("--record", action="store_true", help="append the plan to the ledger (do this only for entries you actually placed)")

    s = sub.add_parser("run", help="price a board and build the stake plan"); add_run_args(s); s.set_defaults(fn=cmd_run)
    s = sub.add_parser("demo", help="run the bundled example slate"); add_run_args(s); s.set_defaults(fn=cmd_demo)

    s = sub.add_parser("settle", help="settle open entries from a results JSON {leg_id: hit|miss|push}")
    s.add_argument("--results", required=True); s.add_argument("--closing", help="JSON {leg_id: fair prob of that side at close}")
    s.add_argument("--ledger"); s.add_argument("--state"); s.set_defaults(fn=cmd_settle)

    s = sub.add_parser("report", help="ledger metrics: ROI, CLV, calibration"); s.add_argument("--ledger"); s.set_defaults(fn=cmd_report)
    s = sub.add_parser("calibrate", help="compare realised stat spread with sigma priors"); s.add_argument("--ledger"); s.set_defaults(fn=cmd_calibrate)

    s = sub.add_parser("fetch-odds", help="pull player props from The Odds API into quotes JSON")
    s.add_argument("--sport", required=True, help="e.g. americanfootball_nfl, basketball_nba")
    s.add_argument("--markets", required=True, help="comma list of Odds API market keys, e.g. player_pass_yds,player_reception_yds")
    s.add_argument("--regions", default="us,eu"); s.add_argument("--events", help="comma list of event ids (default: all upcoming)")
    s.add_argument("--api-key"); s.add_argument("--out", default="odds.json"); s.set_defaults(fn=cmd_fetch_odds)

    s = sub.add_parser("parse-board", help="LLM: turn pasted board text into board JSON (any provider)")
    s.add_argument("--text", required=True); s.add_argument("--provider", default=os.environ.get("PQ_LLM_PROVIDER", "openai"))
    s.add_argument("--model", default=os.environ.get("PQ_LLM_MODEL")); s.add_argument("--sport"); s.add_argument("--slate-id"); s.add_argument("--out", default="board.json")
    s.set_defaults(fn=cmd_parse_board)

    s = sub.add_parser("overlay", help="LLM: bounded probability adjustments from news text (any provider)")
    s.add_argument("--result", required=True, help="result.json from a run"); s.add_argument("--news", required=True, help="text file of news/injury notes")
    s.add_argument("--provider", default=os.environ.get("PQ_LLM_PROVIDER", "openai")); s.add_argument("--model", default=os.environ.get("PQ_LLM_MODEL"))
    s.add_argument("--out", default="overlay.json"); s.set_defaults(fn=cmd_overlay)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
