"""stateRef resolution of the standalone Plane adapter."""

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "plane_adapter", ROOT / "adapters/plane/plane_adapter.py"
)
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)

STATES = [
    {"id": "0d3ba5ec-bfb1-4013-a2f0-f14d2259cc96", "name": "Backlog", "group": "backlog"},
    {"id": "11111111-aaaa-bbbb-cccc-222222222222", "name": "Todo", "group": "unstarted"},
]


class ResolveStateRefTests(unittest.TestCase):
    def resolve(self, ref):
        with patch.object(ADAPTER, "states_for", return_value=STATES):
            return ADAPTER.resolve_state_ref({}, "proj", ref)

    def test_state_id_resolves_to_itself(self):
        self.assertEqual(
            self.resolve("0d3ba5ec-bfb1-4013-a2f0-f14d2259cc96"),
            "0d3ba5ec-bfb1-4013-a2f0-f14d2259cc96",
        )

    def test_name_and_group_alias_still_resolve(self):
        self.assertEqual(self.resolve("todo"), "11111111-aaaa-bbbb-cccc-222222222222")
        self.assertEqual(self.resolve("Backlog"), "0d3ba5ec-bfb1-4013-a2f0-f14d2259cc96")

    def test_unknown_ref_is_not_found(self):
        with self.assertRaises(ADAPTER.AdapterError):
            self.resolve("missing")


if __name__ == "__main__":
    unittest.main()
