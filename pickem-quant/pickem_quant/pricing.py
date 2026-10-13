"""Turn a pick'em board plus sportsbook quotes into fair probabilities at the board's lines."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Iterable, Sequence

from .odds import fair_two_way, consensus, logit, expit
from .marginals import LineQuote, fit_marginal, Marginal
from .schema import Quote, BoardItem, Leg

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.replace(".", "").replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    parts = [p for p in s.split() if p not in _SUFFIXES]
    return " ".join(parts)


def _age_minutes(ts: str | None, now: datetime | None) -> float | None:
    if not ts or not now:
        return None
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (now - t).total_seconds() / 60.0
    except ValueError:
        return None


def price_item(item: BoardItem, quotes: Sequence[Quote], cfg: dict, sigma_priors: dict,
               now: datetime | None = None) -> tuple[Leg | None, Leg | None, dict]:
    """Price both sides of one board item. Returns (over_leg, under_leg, diagnostics)."""
    pcfg = cfg.get("pricing", {})
    method = pcfg.get("devig_method", "power")
    weights = pcfg.get("book_weights", {})
    max_age = pcfg.get("max_quote_age_minutes")
    key_player, key_market = norm_name(item.player), item.market

    by_book: dict[str, list[LineQuote]] = {}
    used = 0
    for q in quotes:
        if norm_name(q.player) != key_player or q.market != key_market:
            continue
        age = _age_minutes(q.ts, now)
        if max_age is not None and age is not None and age > max_age:
            continue
        po, _ = fair_two_way(q.price_over, q.price_under, method)
        by_book.setdefault(q.book.lower(), []).append(LineQuote(q.line, po))
        used += 1
    if used == 0 or len(by_book) < int(pcfg.get("min_books", 1)):
        return None, None, {"reason": "no quotes", "player": item.player, "market": item.market}

    votes: list[tuple[float, float]] = []
    fits: dict[str, Marginal] = {}
    for book, lqs in by_book.items():
        m = fit_marginal(item.market, lqs, sigma_priors)
        fits[book] = m
        p_over_betr = m.p_side(item.line, "over")
        w = float(weights.get(book, weights.get("default", 0.7)))
        votes.append((p_over_betr, w))
    p_over = consensus(votes)

    # optional global shrink toward 0.5: hedges the fact that book consensus is itself noisy
    shrink = float(pcfg.get("shrink_to_half", 0.0))
    p_raw = p_over
    if shrink:
        p_over = expit((1.0 - shrink) * logit(p_over))

    heaviest = max(by_book, key=lambda b: float(weights.get(b, weights.get("default", 0.7))))
    main_line = by_book[heaviest][0].line
    main_p = by_book[heaviest][0].p_over
    diag = {"books": sorted(by_book), "fits": {b: m.to_dict() for b, m in fits.items()},
            "p_over_votes": votes, "p_over": p_over, "main_book": heaviest}

    base = dict(player=item.player, team=item.team, game_id=item.game_id, market=item.market, line=item.line,
                book_line=main_line, book_p_over=main_p, n_books=len(by_book), opponent=item.opponent,
                pick_type=item.pick_type, multiplier_mod=item.multiplier_mod, start_time=item.start_time)
    ident = f"{norm_name(item.player).replace(' ', '_')}|{item.market}|{item.line:g}"
    over = Leg(id=f"{ident}|over", side="over", p=p_over, p_raw=p_raw, **base) if "over" in item.sides_allowed else None
    under = Leg(id=f"{ident}|under", side="under", p=1.0 - p_over, p_raw=1.0 - p_raw, **base) if "under" in item.sides_allowed else None
    return over, under, diag


def price_board(board: Iterable[BoardItem], quotes: Sequence[Quote], cfg: dict, sigma_priors: dict,
                now: datetime | None = None) -> tuple[list[Leg], list[dict]]:
    legs: list[Leg] = []
    diags: list[dict] = []
    excluded = set(cfg.get("legs", {}).get("exclude_markets", []))
    for item in board:
        if item.market in excluded:
            continue
        o, u, d = price_item(item, quotes, cfg, sigma_priors, now)
        diags.append(d)
        for leg in (o, u):
            if leg is not None:
                legs.append(leg)
    return legs, diags


def select_legs(legs: Sequence[Leg], reference_breakeven: float, cfg: dict) -> list[Leg]:
    """Keep legs whose fair probability clears the reference breakeven by min_edge; keep the best K."""
    lcfg = cfg.get("legs", {})
    min_edge = float(lcfg.get("min_edge", 0.0))
    floor = float(lcfg.get("min_leg_prob", 0.0))
    keep = [l for l in legs if l.p >= max(reference_breakeven + min_edge, floor)]
    keep.sort(key=lambda l: -l.p)
    return keep[: int(lcfg.get("max_legs_considered", 24))]
