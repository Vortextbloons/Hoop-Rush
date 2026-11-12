import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

photos = importlib.import_module("scripts.import-nba.fetch_bbref_photos")


class BBRefPhotoTests(unittest.TestCase):
    def test_run_uses_verified_ids_and_preserves_existing_photos(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pools").mkdir()
            players = [
                {"playerExternalId": "1", "altIds": {"nbaHeadshotAvailable": False}},
                {"playerExternalId": "2", "altIds": {"photoUrl": "https://existing/photo.jpg"}},
                {"playerExternalId": "3", "altIds": {"nbaHeadshotAvailable": True}},
                {"playerExternalId": "4", "altIds": {}},
            ]
            (root / "pools" / "pool.json").write_text(json.dumps({"players": players}))
            (root / "bbref_ids.json").write_text(json.dumps({"1": "breweji01", "2": "other01", "3": "third01"}))
            photo_path = root / "fallback_photos.json"
            photo_path.write_text(json.dumps({"saved": "https://existing/saved.jpg"}))
            response = Mock(status_code=200, headers={"Content-Type": "image/jpeg"},
                            content=b"\xff\xd8\xff" + b"x" * 2000 + b"\xff\xd9")
            with patch.object(photos, "PUBLIC_DATA", root), patch.object(photos, "RAW_CACHE", root), \
                    patch.object(photos, "PHOTO_PATH", photo_path), patch.object(photos.LIMITER, "wait"), \
                    patch("requests.get", return_value=response) as get:
                photos.run()
            get.assert_called_once()
            self.assertTrue(get.call_args.args[0].endswith("/breweji01.jpg"))
            self.assertEqual(json.loads(photo_path.read_text()), {
                "saved": "https://existing/saved.jpg",
                "1": photos.HEADSHOT_URL.format(id="breweji01"),
            })

    def test_accepts_complete_jpeg(self):
        response = Mock(status_code=200, headers={"Content-Type": "image/jpeg"},
                        content=b"\xff\xd8\xff" + b"x" * 2000 + b"\xff\xd9")
        self.assertTrue(photos.photo_available(response))

    def test_rejects_missing_blocked_html_and_truncated_images(self):
        for status, mime, content in [
            (404, "image/jpeg", b"\xff\xd8\xff" + b"x" * 2000 + b"\xff\xd9"),
            (403, "text/html", b"blocked" * 300),
            (200, "image/jpeg", b"<html>" + b"x" * 2000),
            (200, "image/jpeg", b"\xff\xd8\xff" + b"x" * 2000),
        ]:
            self.assertFalse(photos.photo_available(
                Mock(status_code=status, headers={"Content-Type": mime}, content=content)))
