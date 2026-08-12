#!/usr/bin/env python3
"""Regression tests for validate_delivery_trace.py."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate_delivery_trace.py")
SPEC = importlib.util.spec_from_file_location("validate_delivery_trace", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class DeliveryJournalMatchingTest(unittest.TestCase):
    def test_requires_matching_plan_field(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal_root = root / "docs" / "journal"
            journal_root.mkdir(parents=True)
            journal = journal_root / "delivery.md"
            journal.write_text(
                """# Delivery

记录类型：delivery

Plan：[PLAN-008](../plans/PLAN-008.md)

## Evidence

`PLAN-001` historical audit reported the expected warning.
""",
                encoding="utf-8",
            )

            self.assertEqual(MODULE.delivery_journals(root, "PLAN-001"), [])
            self.assertEqual(MODULE.delivery_journals(root, "PLAN-008"), [journal])


if __name__ == "__main__":
    unittest.main()
