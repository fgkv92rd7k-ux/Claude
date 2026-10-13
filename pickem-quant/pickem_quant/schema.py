"""Plain data records shared by every module. JSON in, JSON out, no framework."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Quote:
    """One two-way sportsbook quote on a player prop."""
    player: str
    market: str            # canonical market key, e.g. nfl_rec_yds (see config/sigma_priors.json)
    line: float
    book: str
    price_over: float      # American odds (e.g. -115)
    price_under: float
    team: str = ""
    game_id: str = ""
    ts: Optional[str] = None   # ISO-8601 timestamp of the quote (used for staleness)

    def to_dict(self):
        return asdict(self)


@dataclass
class BoardItem:
    """One line offered on the pick'em board (Betr)."""
    player: str
    market: str
    line: float
    team: str = ""
    opponent: str = ""
    game_id: str = ""
    start_time: Optional[str] = None
    pick_type: str = "standard"      # standard | boost | edge | anchor | scorcher ...
    multiplier_mod: float = 1.0      # multiplicative change the pick applies to the ENTRY multiplier (app-specific)
    sides_allowed: tuple = ("over", "under")

    def to_dict(self):
        return asdict(self)


@dataclass
class Leg:
    """A priced side of a board item: the atomic thing we can put in an entry."""
    id: str
    player: str
    team: str
    game_id: str
    market: str
    line: float
    side: str                       # over | under
    p: float                        # fair probability of this side at the Betr line
    p_raw: float = 0.0              # probability before any overlay / shade
    book_line: Optional[float] = None
    book_p_over: Optional[float] = None   # devigged consensus P(over book_line)
    n_books: int = 0
    opponent: str = ""
    pick_type: str = "standard"
    multiplier_mod: float = 1.0
    start_time: Optional[str] = None
    notes: list = field(default_factory=list)

    @property
    def sign(self) -> int:
        return 1 if self.side == "over" else -1

    @property
    def player_key(self) -> str:
        return f"{self.player}|{self.market}".lower()

    def to_dict(self):
        d = asdict(self)
        return d


@dataclass
class Entry:
    """A candidate entry: a set of legs under a payout mode."""
    legs: tuple               # tuple of leg ids
    mode: str                 # perfect | flex
    n: int
    multiplier_mod: float = 1.0
    p_all: float = 0.0        # P(all legs hit) under the correlated simulation
    ev_cash: float = 0.0      # expected return per $1 of cash (net)
    ev_cash_indep: float = 0.0  # same, pretending legs are independent (lift = ev_cash - ev_cash_indep)
    ev_promo: float = 0.0     # expected cash credited per $1 of promo stake
    sd_cash: float = 0.0
    hit_dist: dict = field(default_factory=dict)   # {hits: probability}
    key: str = ""

    def __post_init__(self):
        if not self.key:
            self.key = f"{self.mode}:{'+'.join(sorted(self.legs))}"

    def to_dict(self):
        d = asdict(self)
        d["legs"] = list(self.legs)
        return d
