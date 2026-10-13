"""pickem-quant: a quantitative engine for pick'em DFS (Betr Picks, PrizePicks-style boards).

Pipeline:  sportsbook quotes -> devig -> marginal fit -> probability at the Betr line
           -> copula-correlated Monte Carlo -> candidate entries -> scenario MVO / Kelly
           -> stake plan -> ledger (CLV, calibration) -> kill switches.

Pure numpy/scipy. No LLM dependency in the decision path; an optional, bounded LLM
overlay lives in pickem_quant.llm and works with any provider.
"""
__version__ = "0.1.0"
