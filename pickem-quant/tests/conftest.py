import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import pytest


@pytest.fixture
def root():
    return ROOT


@pytest.fixture
def cfg(root):
    from pickem_quant.io import load_config
    return load_config(os.path.join(root, "config", "default.json"))


@pytest.fixture
def table(cfg):
    from pickem_quant.payouts import PayoutTable
    return PayoutTable.load(cfg["payout_table"])
