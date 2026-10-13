# pickem-quant

A quantitative engine for pick'em DFS (built for **Betr Picks**, works for any fixed-multiplier board).
Pure Python (numpy + scipy). No model lock-in: the decision path contains no LLM; the optional LLM
helpers run on OpenAI-compatible endpoints (GPT-6 Astra), Google Gemini (Gemini 4 Argon) or Anthropic
(Claude) through the same six-line client. The operating manual, `AGENT_PROTOCOL.md`, is written for any
of them.

```
quotes (Pinnacle/DK/FD...) --devig--> fair p at book line --fitted marginal--> fair p at Betr line
      --> keep legs above the structure breakeven
      --> Gaussian-copula Monte Carlo (same-game correlation priors)
      --> candidate entries (beam search on joint hit probability; perfect + flex; 2..6 legs)
      --> scenario Kelly (default) or scenario MVO, two bankrolls (cash + promo), caps, stake ladder
      --> plan.md / result.json  --> ledger (CLV, Brier, calibration) --> kill switches
```

## Quick start

```bash
cd pickem-quant
pip install numpy scipy            # that is the whole dependency list (pytest for tests)
python -m pickem_quant breakeven   # the bar each structure must clear
python -m pickem_quant demo        # bundled example slate -> out/demo/plan.md
python -m pytest -q                # 25 tests
```

Real slate:

```bash
python -m pickem_quant run \
  --board board.json --odds odds.json \
  --cash 100 --promo 125 --promo-expires 2026-11-05 \
  --slate-id nfl-sun-2026-10-18
# read out/nfl-sun-2026-10-18/plan.md ; place exactly those entries ; then
python -m pickem_quant run ... --record
# after the games:
python -m pickem_quant settle --results results.json --closing closing.json
python -m pickem_quant report
```

`pip install -e .` gives you the `pq` command instead of `python -m pickem_quant`.

## Inputs

- `board.json` — the Betr lines: `{"slate_id": ..., "items": [{player, team, opponent, game_id, market, line, start_time, pick_type, multiplier_mod}]}`. CSV with the same columns also works. `multiplier_mod` is how boosted/edge picks change the entry multiplier (1.0 for standard).
- `odds.json` — two-sided sportsbook quotes: `{"quotes": [{player, market, line, book, price_over, price_under, game_id, ts}]}`. American odds. Several books and several alt lines per player are welcome: alt lines let the marginal fit both location and scale. `python -m pickem_quant fetch-odds --sport americanfootball_nfl --markets player_pass_yds,player_reception_yds --regions us,eu` pulls them from The Odds API (`ODDS_API_KEY`), Pinnacle included via `eu`.
- `config/default.json` — bankrolls, pricing, entry generation, portfolio, risk. `config/payouts.betr.json` — the multiplier tables (see "Verify" below). `config/sigma_priors.json`, `config/correlation_priors.json` — priors you should replace with your own estimates over time.

Market keys are canonical strings such as `nfl_pass_yds`, `nfl_receptions`, `nba_points`, `mlb_strikeouts` (full list in `config/sigma_priors.json`).

## The two bankrolls

| | cash | promo (Betr Bucks) |
|---|---|---|
| Return on a win | multiplier x stake | (multiplier − 1) x stake, credited to cash; stake not returned |
| Return on a loss | −stake | 0 cash (the promo dollar is gone, but it never was cash) |
| Withdrawable | yes | no; winnings are |
| Expiry | none | 30 days after issue (`--promo-expires`) |
| Sizing | fractional Kelly on log wealth | full deployment of the slate budget into the highest-conversion entries, paced by expiry |

Both are optimized **jointly on the same simulated scenarios**, so the optimizer knows that a cash ticket
and a promo ticket on the same QB stack win together. With the default settings on a $100 cash / $125
promo account the expected cash profit is dominated by promo conversion (roughly 0.6–1.5 cash per promo
dollar depending on the edge available), and cash stakes are $1–$2 per entry. That is what the math says
for a bankroll that size; read `AGENT_PROTOCOL.md` section 3 before "fixing" it.

If your $125 is literally **Betr Cash** (the sweepstakes currency), Betr's help center says it is not
usable on Picks at all; this engine assumes the Picks promo currency, Betr Bucks. If the app does return
your stake on promo wins, set `bankrolls.promo.rules.mode` to `"cash"`.

## Verify before the first real entry

`config/payouts.betr.json` was built from public sources in October 2026 and contains rows that could not
be confirmed twice (6-pick perfect 40x vs 35x; 4-pick flex 5x vs 6x; 7/8-pick flex partial tiers missing;
no 9/10-pick rows). The entry screen's number wins: edit the JSON, rerun. The engine prints these notes
on every plan until you delete them from the file.

## What is actually in the model

- **Devig** (`odds.py`): multiplicative, additive, power (default) and Shin. Consensus across books is a
  weighted mean in logit space; weights in `pricing.book_weights` (Pinnacle 3, Circa 2.5, DK/FD 1, ...).
- **Line translation** (`marginals.py`): a normal (yardage, points) or Poisson (receptions, 3PM, hits,
  TDs) marginal is fitted per book from its quotes, then evaluated at the Betr line. One quote fixes the
  location and uses the sigma prior for scale; two or more quotes fit both. Pushes on integer lines are
  conditioned away (sites void them).
- **Shrink**: 10% toward 0.5 in logit space. Sportsbook consensus is a noisy estimate of truth; this is
  the cheapest hedge against over-trusting it. Tune with the ledger.
- **Correlation** (`correlation.py`): rule-based latent correlations by scope (same player / same team /
  opponents / same game) and market pair, signed by over/under, projected to the nearest correlation
  matrix. One latent per board item, so the over and under of the same line are exact complements.
- **Simulation** (`simulate.py`): Gaussian copula, common random numbers across every entry so entry
  comparisons are not swamped by Monte Carlo noise. 40,000 scenarios in ~0.1 s.
- **Entries** (`entries.py`): exhaustive pairs over the top-K legs, then beam search by log joint-hit
  probability up to 6 legs; both perfect and flex structures scored on the simulation; one leg per
  player per entry; at least two games per entry (configurable).
- **Portfolio** (`portfolio.py`): assets are (entry, bankroll). Kelly maximises mean log(cash + P&L)
  over scenarios with SLSQP; MVO maximises mean − ½·risk-weighted variance with λ = k / cash bankroll
  (k = 3 ≈ third-Kelly in the quadratic approximation; promo gets its own k). Constraints: per-bankroll
  slate budget, per-entry cap, per-leg exposure cap, entry count, $0.50 ladder with a $1 minimum
  (minimum-lot handled by iterative drop-and-resolve).
- **Ledger** (`ledger.py`): every placed entry with each leg's fair p, book line, Betr line; settlement
  with push handling (an n-pick collapses to n−1); CLV in logit space against closing fair probabilities;
  Brier, log loss, reliability bins, hit rate by market. `pq calibrate` compares realised stat spread with
  the sigma priors once you log actual stat values.
- **Bankroll** (`bankroll.py`): drawdown throttle (halve at 40%, stop at 60%), promo expiry pacing, CLV
  kill switch (rolling 150 legs below −0.01 logit halts the desk).
- **LLM layer** (`llm/`): `client.complete_json(provider, model, system, user)` for openai / gemini /
  anthropic with stdlib only. Used by `pq parse-board` (pasted board text → JSON) and `pq overlay` (news →
  bounded logit shifts, clamped to ±0.25 and applied symmetrically to both sides of a line). The engine
  never calls an LLM unless you run those commands.

## Where the edge comes from, honestly

1. **Stale or soft lines.** Betr prices every leg at the same multiplier; the sharp books do not. A Betr
   line 5–10 yards off Pinnacle is worth 2–5 points of probability. That is most of the edge.
2. **Correlation the house ignores.** A 6-pick with two positively correlated same-team pairs can carry a
   joint hit probability 30–50% above the product of the legs. The payout does not change.
3. **Promo conversion.** A promo dollar on a 5-pick at p≈0.08 and 19x-to-cash converts at ~1.5 cash per
   promo dollar in expectation. It is the single biggest line item for this account size.

What it is not: a projection system. If you want player projections, feed them in as "books" with a
weight; the pipeline treats any two-sided price the same way.

## Portability

- Engine: Python ≥ 3.10, numpy, scipy. Runs anywhere.
- Agent: `AGENT_PROTOCOL.md` (full) or `prompts/agent_system_prompt.txt` (compact) as the system prompt
  for Claude, GPT-6 Astra, Gemini 4 Argon or any other model with a shell. Section 5 of the protocol is
  the hand-arithmetic fallback for a model without a runtime.
- LLM helpers: `PQ_LLM_PROVIDER=openai|gemini|anthropic`, `PQ_LLM_MODEL=<id>`, keys via `OPENAI_API_KEY`
  / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`; `OPENAI_BASE_URL` points the OpenAI client at any compatible server.

## Layout

```
pickem_quant/   odds.py marginals.py payouts.py pricing.py correlation.py simulate.py entries.py
                portfolio.py bankroll.py ledger.py engine.py report.py io.py cli.py schema.py
                providers/the_odds_api.py   llm/{client,prompts,board_parser,overlay}.py
config/         default.json payouts.betr.json sigma_priors.json correlation_priors.json
examples/       board.sample.json odds.sample.json   (illustrative numbers, not real lines)
tests/          25 tests: devig, breakevens, marginals, copula, entries, optimizer, ledger, CLI demo
AGENT_PROTOCOL.md  prompts/agent_system_prompt.txt
```

This is a tool for a legal DFS product in states that allow it; it does not remove variance, and a small
bankroll can and will have losing months even with a real edge. Stakes the plan prints are the stakes.
