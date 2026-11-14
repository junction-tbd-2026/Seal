import tempfile
import unittest
from pathlib import Path

from reviewer_controls.config import (
    KEYS_FILE_ENV,
    KeysFileInRepoError,
    MissingKeyError,
    inside_git_repo,
    load_settings,
    parse_keys_file,
    require,
    status,
)

# Short, obviously fake values only: nothing here may look like a real key.
FAKE = "fake-value"


class ConfigTests(unittest.TestCase):
    def test_parse_skips_comments_blanks_and_empty_values(self):
        text = "# note\n\nA=1\nB=\nC = 'x y'\nnot a pair\n"
        self.assertEqual(parse_keys_file(text), {"A": "1", "C": "x y"})

    def test_keys_file_outside_a_repo_is_loaded(self):
        with tempfile.TemporaryDirectory() as folder:
            keys = Path(folder) / "keys.env"
            keys.write_text("REVIEWER_API_KEY={}\n".format(FAKE))
            settings = load_settings({KEYS_FILE_ENV: str(keys)})
            self.assertEqual(settings["REVIEWER_API_KEY"], FAKE)

    def test_keys_file_inside_a_repo_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / ".git").mkdir()
            nested = Path(folder) / "sub"
            nested.mkdir()
            keys = nested / "keys.env"
            keys.write_text("REVIEWER_API_KEY={}\n".format(FAKE))
            self.assertTrue(inside_git_repo(keys))
            with self.assertRaises(KeysFileInRepoError):
                load_settings({KEYS_FILE_ENV: str(keys)})

    def test_environment_overrides_file(self):
        with tempfile.TemporaryDirectory() as folder:
            keys = Path(folder) / "keys.env"
            keys.write_text("REVIEWER_MODEL=from-file\n")
            settings = load_settings({KEYS_FILE_ENV: str(keys), "REVIEWER_MODEL": "from-env"})
            self.assertEqual(settings["REVIEWER_MODEL"], "from-env")

    def test_missing_keys_file_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = load_settings({KEYS_FILE_ENV: str(Path(folder) / "absent.env")})
            self.assertEqual(settings, {})

    def test_require_names_the_setting_but_never_a_value(self):
        with self.assertRaises(MissingKeyError) as caught:
            require({"OTHER": FAKE}, "REVIEWER_API_KEY")
        self.assertIn("REVIEWER_API_KEY", str(caught.exception))
        self.assertNotIn(FAKE, str(caught.exception))

    def test_status_never_reveals_the_value(self):
        self.assertEqual(status({"A": FAKE}, "A"), "set")
        self.assertEqual(status({}, "A"), "missing")


if __name__ == "__main__":
    unittest.main()
