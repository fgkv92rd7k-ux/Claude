"""The Odds API (the-odds-api.com) player-prop puller -> list[Quote].

Needs an API key (ODDS_API_KEY). Player props are per-event endpoints and cost credits per
market x region; keep the market list tight. Pinnacle is in region 'eu'.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Sequence

from ..schema import Quote

BASE = "https://api.the-odds-api.com/v4"

SPORT_PREFIX = {"americanfootball_nfl": "nfl", "americanfootball_ncaaf": "nfl", "basketball_nba": "nba",
                "basketball_ncaab": "nba", "basketball_wnba": "nba", "baseball_mlb": "mlb", "icehockey_nhl": "nhl",
                "soccer": "soccer"}

MARKET_MAP = {
    "player_pass_yds": "pass_yds", "player_pass_tds": "pass_tds", "player_pass_attempts": "pass_att",
    "player_pass_completions": "pass_comp", "player_rush_yds": "rush_yds", "player_rush_attempts": "rush_att",
    "player_reception_yds": "rec_yds", "player_receptions": "receptions", "player_rush_reception_yds": "rush_rec_yds",
    "player_kicking_points": "kick_pts",
    "player_points": "points", "player_rebounds": "rebounds", "player_assists": "assists", "player_threes": "threes",
    "player_points_rebounds_assists": "pra", "player_points_rebounds": "pts_reb", "player_points_assists": "pts_ast",
    "player_steals": "steals", "player_blocks": "blocks", "player_turnovers": "turnovers",
    "batter_hits": "hits", "batter_total_bases": "total_bases", "pitcher_strikeouts": "strikeouts",
    "pitcher_hits_allowed": "hits_allowed", "pitcher_earned_runs": "earned_runs", "pitcher_outs": "outs",
    "player_shots_on_goal": "shots", "player_saves": "saves",
}


def canonical_market(sport_key: str, market_key: str) -> str | None:
    prefix = next((v for k, v in SPORT_PREFIX.items() if sport_key.startswith(k)), None)
    suffix = MARKET_MAP.get(market_key)
    if not prefix or not suffix:
        return None
    return f"{prefix}_{suffix}"


def _get(url: str, params: dict) -> object:
    full = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=30) as resp:
        return json.loads(resp.read().decode())


def list_events(sport: str, api_key: str) -> list[dict]:
    return _get(f"{BASE}/sports/{sport}/events", {"apiKey": api_key})


def fetch_player_props(sport: str, markets: Sequence[str], api_key: str, regions: str = "us,eu",
                       event_ids: Sequence[str] | None = None) -> list[Quote]:
    if not api_key:
        raise SystemExit("set ODDS_API_KEY or pass --api-key")
    if not event_ids:
        event_ids = [e["id"] for e in list_events(sport, api_key)]
    quotes: list[Quote] = []
    for eid in event_ids:
        data = _get(f"{BASE}/sports/{sport}/events/{eid}/odds",
                    {"apiKey": api_key, "regions": regions, "markets": ",".join(markets), "oddsFormat": "american"})
        game_id = f"{data.get('away_team','')}@{data.get('home_team','')}"
        for bm in data.get("bookmakers", []):
            for mk in bm.get("markets", []):
                canon = canonical_market(sport, mk["key"])
                if not canon:
                    continue
                pairs: dict[tuple[str, float], dict] = {}
                for o in mk.get("outcomes", []):
                    key = (o.get("description", ""), float(o.get("point", 0)))
                    pairs.setdefault(key, {})[o["name"].lower()] = float(o["price"])
                for (player, point), sides in pairs.items():
                    if "over" in sides and "under" in sides:
                        quotes.append(Quote(player=player, market=canon, line=point, book=bm["key"],
                                            price_over=sides["over"], price_under=sides["under"],
                                            game_id=game_id, ts=mk.get("last_update") or bm.get("last_update")))
    return quotes
