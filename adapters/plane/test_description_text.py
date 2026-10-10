"""Description contract shared by the standalone Plane adapter and harness CLI."""

import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ADAPTER = load_module("plane_adapter", "adapters/plane/plane_adapter.py")
CLI = load_module("kanban_cli", ".agents/skills/kanban/scripts/kanban_cli.py")


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
        for module in (ADAPTER, CLI):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}), expected)

    def test_html_takes_precedence_over_flattened_text(self):
        for module in (ADAPTER, CLI):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({
                    "description_html": "<p>One</p><p>Two</p>",
                    "description_stripped": "OneTwo",
                }), "One\n\nTwo")

    def test_plain_text_is_preserved_and_empty_description_is_null(self):
        for module in (ADAPTER, CLI):
            for key in ("description_stripped", "description"):
                with self.subTest(module=module.__name__, key=key):
                    self.assertEqual(module.description_of({key: "Use <T> & keep\nlines"}),
                                     "Use <T> & keep\nlines")
            for issue in ({}, {"description_html": "<p><br></p>"}, {"description": "  "}):
                with self.subTest(module=module.__name__, issue=issue):
                    self.assertIsNone(module.description_of(issue))

    def test_cli_get_prints_text_but_json_preserves_api_response(self):
        issue = {"description_html": "<p>One &amp; two</p><p>Next</p>"}
        for as_json in (False, True):
            output = io.StringIO()
            args = argparse.Namespace(ref="NEKODE-1", project=None, json=as_json)
            with patch.object(CLI, "resolve_issue_ref", return_value=("id", "project", "NEKODE-1")), \
                 patch.object(CLI, "ws", return_value="workspace"), \
                 patch.object(CLI, "api_request", return_value=(200, issue)), \
                 patch.object(CLI, "print_issues_table"), contextlib.redirect_stdout(output):
                CLI.cmd_get(args)
            if as_json:
                self.assertEqual(json.loads(output.getvalue()), issue)
            else:
                self.assertIn("One & two\n\nNext", output.getvalue())
                self.assertNotIn("<p>", output.getvalue())

    def test_nested_lists_and_link_labels(self):
        source = (
            '<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>'
            '<p><a href="https://example.com">https://example.com</a> '
            '<a href="/path"></a></p>'
        )
        for module in (ADAPTER, CLI):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}),
                                 "- Parent\n  - Child\n- Next\n\nhttps://example.com /path")

    def test_hidden_content_is_removed_and_literal_angle_brackets_survive(self):
        source = (
            '<style>.x {color: red}</style><script>alert(1)</script>'
            '<p>Use &lt;T&gt; &amp; &quot;text&quot;.</p><!-- comment -->'
        )
        for module in (ADAPTER, CLI):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": source}),
                                 'Use <T> & "text".')

    def test_write_conversion_round_trip(self):
        text = "First & <T>\nSecond line\n\nNext paragraph"
        for module in (ADAPTER, CLI):
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
        for module in (ADAPTER, CLI):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.description_of({"description_html": f"<pre><code>{text}</code></pre>"}),
                                 text)


if __name__ == "__main__":
    unittest.main()
