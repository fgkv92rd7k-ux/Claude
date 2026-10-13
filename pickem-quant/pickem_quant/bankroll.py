"""Bankroll state, slate budgets, drawdown throttle and kill switches."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from datetime import date, datetime, timezone


@dataclass
class State:
    cash: float
    promo: float
    promo_expires: str | None = None      # ISO date
    peak_cash: float = 0.0
    updated: str | None = None
    halted: bool = False
    halt_reason: str = ""

    def to_dict(self):
        return asdict(self)


def load_state(path: str, cfg: dict) -> State:
    if os.path.exists(path):
        with open(path) as fh:
            raw = json.load(fh)
        return State(**{k: raw.get(k) for k in State.__dataclass_fields__})
    b = cfg["bankrolls"]
    st = State(cash=float(b["cash"]["balance"]), promo=float(b["promo"]["balance"]),
               promo_expires=b["promo"].get("rules", {}).get("expires"))
    st.peak_cash = st.cash
    return st


def save_state(path: str, st: State) -> None:
    st.updated = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    with open(path, "w") as fh:
        json.dump(st.to_dict(), fh, indent=2)


def drawdown(st: State) -> float:
    if st.peak_cash <= 0:
        return 0.0
    return max(0.0, 1.0 - st.cash / st.peak_cash)


def slate_budgets(st: State, cfg: dict, today: date | None = None) -> dict:
    """Dollars available for THIS slate from each bankroll, plus the reasons."""
    today = today or date.today()
    pcfg, rcfg = cfg.get("portfolio", {}), cfg.get("risk", {})
    notes = []
    if st.halted:
        return {"cash": 0.0, "promo": 0.0, "notes": [f"HALTED: {st.halt_reason}"]}

    dd = drawdown(st)
    factor = 1.0
    stop = float(rcfg.get("stop_loss_drawdown_pct", 0.4))
    if dd >= stop * 1.5:
        factor = 0.0
        notes.append(f"cash drawdown {dd:.0%} >= {stop*1.5:.0%}: cash play stopped until you reset peak_cash deliberately")
    elif dd >= stop:
        factor = 0.5
        notes.append(f"cash drawdown {dd:.0%} >= {stop:.0%}: cash slate budget halved")
    cash_budget = st.cash * float(pcfg.get("cash", {}).get("slate_budget_pct", 0.25)) * factor

    promo_pct = float(pcfg.get("promo", {}).get("slate_budget_pct", 0.2))
    promo_budget = st.promo * promo_pct
    if st.promo_expires:
        try:
            days_left = (date.fromisoformat(st.promo_expires) - today).days
            if days_left <= 0:
                promo_budget = 0.0
                notes.append("promo balance has expired per state.json; not deployable")
            else:
                # spread what is left over the remaining days, but never slower than the % rule
                promo_budget = max(promo_budget, st.promo / max(1, days_left))
                if days_left <= 2:
                    promo_budget = st.promo
                    notes.append(f"promo expires in {days_left} day(s): deploy everything that clears EV")
        except ValueError:
            notes.append("promo_expires is not an ISO date; ignoring expiry")
    elif st.promo > 0:
        notes.append("promo expiry unknown: pass --promo-expires YYYY-MM-DD (Betr Bucks expire 30 days after issue) so pacing can use it")
    cash_budget = round(min(cash_budget, st.cash), 2)
    promo_budget = round(min(promo_budget, st.promo), 2)
    return {"cash": cash_budget, "promo": promo_budget, "drawdown": dd, "notes": notes}


def apply_settlement(st: State, cash_pnl: float, promo_spent: float, cash_from_promo: float) -> State:
    st.cash = round(st.cash + cash_pnl + cash_from_promo, 2)
    st.promo = round(max(0.0, st.promo - promo_spent), 2)
    st.peak_cash = max(st.peak_cash, st.cash)
    return st


def check_kill_switch(st: State, ledger_metrics: dict, cfg: dict) -> State:
    rcfg = cfg.get("risk", {})
    window = int(rcfg.get("clv_kill_switch_window", 150))
    floor = float(rcfg.get("clv_kill_switch_min_logit", -0.01))
    rolling = ledger_metrics.get("rolling_clv_logit")
    n = ledger_metrics.get("n_legs_with_close", 0)
    if rolling is not None and n >= window and rolling < floor:
        st.halted = True
        st.halt_reason = f"rolling CLV over last {window} closed legs is {rolling:+.4f} logit (< {floor}); the edge is not real. Recalibrate before playing."
    return st
