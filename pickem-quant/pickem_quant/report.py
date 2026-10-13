"""Markdown report for humans and for any LLM agent that has to relay the plan."""
from __future__ import annotations


def _pct(x):
    return "n/a" if x is None else f"{100*x:.1f}%"


def _short(leg_id: str) -> str:
    parts = leg_id.split("|")
    if len(parts) >= 4:
        return f"{parts[0].replace('_', ' ')} {parts[1].split('_', 1)[-1]} {parts[3][0]}{parts[2]}"
    return leg_id


def _money(x):
    return "n/a" if x is None else f"${x:,.2f}"


def render(result: dict) -> str:
    L = []
    L.append(f"# Pick'em plan — slate `{result['slate_id']}` ({result['generated']})\n")
    b = result["budgets"]
    st = result["state"]
    L.append(f"Bankroll: cash {_money(st['cash'])} (slate budget {_money(b['cash'])}), promo {_money(st['promo'])} (slate budget {_money(b['promo'])}).")
    if b.get("notes"):
        for n in b["notes"]:
            L.append(f"- budget note: {n}")
    L.append(f"\nReference breakeven per leg (easiest structure in play): **{result['reference_breakeven']:.4f}**. "
             f"Board items: {result['n_board_items']}, legs priced: {result['n_legs_priced']}, legs clearing the bar: {len(result['legs_selected'])}.")
    if result.get("warnings"):
        L.append("\n## Warnings")
        for w in result["warnings"]:
            L.append(f"- {w}")
    if result.get("payout_notes"):
        L.append("\n## Payout table items to verify in the app")
        for w in result["payout_notes"]:
            L.append(f"- {w}")

    L.append("\n## Legs that clear the bar\n")
    L.append("| # | player | team | market | Betr line | side | fair p | edge vs ref | book line | books |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for i, l in enumerate(result["legs_selected"], 1):
        L.append(f"| {i} | {l['player']} | {l['team']} | {l['market']} | {l['line']:g} | {l['side']} | {l['p']:.3f} | {l['p']-result['reference_breakeven']:+.3f} | {l['book_line'] if l['book_line'] is not None else ''} | {l['n_books']} |")

    plan = result.get("plan") or []
    L.append("\n## Stake plan\n")
    if not plan:
        L.append("_No entries recommended on this slate._")
    else:
        for i, p in enumerate(plan, 1):
            L.append(f"**{i}. {p['bankroll'].upper()} {_money(p['stake'])} — {p['n']}-pick {p['mode']}** · P(all hit) {p['p_all']:.3f} · EV {p['ev_per_dollar']:+.3f}/$ · expected {_money(p['expected_profit'])}")
            for leg in p["legs"]:
                L.append(f"   - {leg['player']} ({leg['team']}) {leg['market']} **{leg['side']} {leg['line']:g}** (p={leg['p']:.3f})")
    a = result.get("allocation")
    if a and a.get("stats") and plan:
        s = a["stats"]
        L.append("\n## Risk summary (this slate, cash terms)\n")
        L.append(f"- objective: {a['objective']} (lambda {s.get('lambda', 0):.4f})")
        L.append(f"- cash staked {_money(s['cash_staked'])} of {_money(s['cash_budget'])}; promo staked {_money(s['promo_staked'])} of {_money(s['promo_budget'])}")
        L.append(f"- expected profit: cash entries {_money(s['ev_cash_entries'])}, promo conversion {_money(s['ev_cash_from_promo'])} (rate {_pct(s['promo_conversion_rate'])}), total {_money(s['ev_total'])} ± {_money(s['sd_total'])}")
        q = s["quantiles"]
        L.append(f"- P&L quantiles: p05 {_money(q['p05'])} · p25 {_money(q['p25'])} · median {_money(q['p50'])} · p75 {_money(q['p75'])} · p95 {_money(q['p95'])}")
        L.append(f"- P(slate loses money) {_pct(s['p_total_negative'])}; P(all cash stakes lost) {_pct(s['p_lose_all_cash_stakes'])}; P(lose half the cash bankroll) {_pct(s['p_lose_half_cash_bankroll'])}")
        if s.get("leg_exposure"):
            L.append("- leg exposure ($ cash / $ promo): " + ", ".join(f"{_short(k)} {v['cash']:.1f}/{v['promo']:.1f}" for k, v in s["leg_exposure"].items()))
    cands = result.get("candidates") or []
    if cands:
        L.append("\n## Top candidate entries (for reference)\n")
        L.append("| mode | n | P(all) | EV cash /$ | corr. lift | EV promo /$ | legs |")
        L.append("|---|---|---|---|---|---|---|")
        for e in cands[:15]:
            L.append(f"| {e['mode']} | {e['n']} | {e['p_all']:.3f} | {e['ev_cash']:+.3f} | {e['ev_cash']-e.get('ev_cash_indep', e['ev_cash']):+.3f} | {e['ev_promo']:.3f} | {', '.join(_short(x) for x in e['legs'])} |")
    L.append("\n## Breakevens (per-leg hit rate needed, independent legs)\n")
    L.append("| mode | n | top multiplier | breakeven |")
    L.append("|---|---|---|---|")
    for r in result["breakevens"]:
        L.append(f"| {r['mode']} | {r['n']} | {r['top_multiplier']:g}x | {r['breakeven_per_leg']:.4f} |")
    L.append("\n_Fair probabilities come from devigged sportsbook consensus translated to the Betr line through a fitted marginal; correlations are priors unless you replaced them. Verify every multiplier on the entry screen._")
    return "\n".join(L)
