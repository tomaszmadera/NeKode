"""Description contract of the standalone Plane adapter.

Only shipped code is asserted here: the harness CLI lives in the untracked
`.agents/` tree, so its rendering contract cannot be checked from this
repository and is not part of the adapter contract.
"""

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    target = ROOT / path
    if not target.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, target)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ADAPTER = load_module("plane_adapter", "adapters/plane/plane_adapter.py")
if ADAPTER is None:
    raise RuntimeError("adapters/plane/plane_adapter.py is missing")
MODULES = [ADAPTER]


class UpdatePriorityTests(unittest.TestCase):
    def test_explicit_null_clears_priority_and_an_omitted_key_does_not(self):
        cfg = {"workspace": "ws"}
        with patch.object(
            ADAPTER, "resolve_issue_identity", return_value=("uuid-1", "proj", None)
        ):
            cleared = ADAPTER.action_update_item(
                cfg, {"ref": "NEKODE-1", "priority": None, "dryRun": True}
            )
            renamed = ADAPTER.action_update_item(
                cfg, {"ref": "NEKODE-1", "title": "Hello", "dryRun": True}
            )
        self.assertEqual(cleared["payload"], {"priority": "none"})
        self.assertEqual(renamed["payload"], {"name": "Hello"})


class DescriptionTextTests(unittest.TestCase):
    def test_html_keeps_paragraphs_lists_links_and_entities(self):
        source = (
            '<h2>Plan &amp; cel</h2><p>Pierwsza<br>druga.</p>'
            '<ul><li><p>Sprawdź <strong>opis</strong></p></li>'
            '<li><a href="https://example.com/a?x=1&amp;y=2">Dokumentacja</a></li></ul>'
            '<ol start="3"><li>Uruchom</li><li>Zakończ</li></ol>'
        )
        expected = (
            'Plan & cel\n\nPierwsza\ndruga.\n\n- Sprawdź opis\n'
            '- Dokumentacja (https://example.com/a?x=1&y=2)\n\n3. Uruchom\n4. Zakończ'
        )
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}), expected)

    def test_html_takes_precedence_over_flattened_text(self):
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({
                    "description_html": "<p>One</p><p>Two</p>",
                    "description_stripped": "OneTwo",
                }), "One\n\nTwo")

    def test_plain_text_is_preserved_and_empty_description_is_null(self):
        for module in MODULES:
            for key in ("description_stripped", "description"):
                with self.subTest(module=module.__name__, key=key):
                    self.assertEqual(module.description_of({key: "Use <T> & keep\nlines"}),
                                     "Use <T> & keep\nlines")
            for issue in ({}, {"description_html": "<p><br></p>"}, {"description": "  "}):
                with self.subTest(module=module.__name__, issue=issue):
                    self.assertIsNone(module.description_of(issue))

    def test_nested_lists_and_link_labels(self):
        source = (
            '<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>'
            '<p><a href="https://example.com">https://example.com</a> '
            '<a href="/path"></a></p>'
        )
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}),
                                 "- Parent\n  - Child\n- Next\n\nhttps://example.com /path")

    def test_hidden_content_is_removed_and_literal_angle_brackets_survive(self):
        source = (
            '<style>.x {color: red}</style><script>alert(1)</script>'
            '<p>Use &lt;T&gt; &amp; &quot;text&quot;.</p><!-- comment -->'
        )
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}),
                                 'Use <T> & "text".')

    def test_write_conversion_round_trip(self):
        text = "First & <T>\nSecond line\n\nNext paragraph"
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": module.text_to_html(text)}),
                                 text)

    def test_board_and_get_item_receive_converted_description(self):
        cfg = {"project": "project", "base_url": "https://example.com", "workspace": "ws"}
        issue = {"id": "id", "description_html": "<p>First</p><p>Next</p>"}
        with (
            patch.object(ADAPTER, "identifier_for", return_value="NEKODE"),
            patch.object(ADAPTER, "states_for", return_value=[]),
            patch.object(ADAPTER, "fetch_items", return_value=[issue]),
            patch.object(ADAPTER, "resolve_issue_identity", return_value=("id", "project", issue)),
        ):
            board = ADAPTER.action_list_items(cfg, {})
            item = ADAPTER.action_get_item(cfg, {"ref": "NEKODE-1"})
        self.assertEqual(board[0]["description"], "First\n\nNext")
        self.assertEqual(item["description"], "First\n\nNext")

    def test_code_blocks_keep_indentation_and_blank_lines(self):
        text = "  if x:\n    run()\n\n  done()"
        for module in MODULES:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": f"<pre><code>{text}</code></pre>"}),
                                 text)


if __name__ == "__main__":
    unittest.main()
