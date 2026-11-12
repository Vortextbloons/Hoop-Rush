import importlib
import unittest
from unittest.mock import Mock, patch

photos = importlib.import_module("scripts.import-nba.fetch_wikipedia_photos")


class WikipediaPhotoTests(unittest.TestCase):
    def lookup(self, page):
        response = Mock()
        response.json.return_value = {"query": {"pages": {"1": page}}}
        with patch("requests.get", return_value=response) as get, patch.object(photos.WIKI_LIMITER, "wait"):
            result = photos._pageimage("Rick Adelman")
        self.assertIn("HoopRush/", get.call_args.kwargs["headers"]["User-Agent"])
        self.assertIn("https://github.com/Vortextbloons/Hoop-Rush", get.call_args.kwargs["headers"]["User-Agent"])
        return result

    def test_basketball_biography_photo(self):
        url = "https://upload.wikimedia.org/wikipedia/commons/0/05/Rick_Adelman.png"
        self.assertEqual(self.lookup({"extract": "An American basketball player and coach.",
                                      "thumbnail": {"source": url}}), url)

    def test_unrelated_person_and_disambiguation_rejected(self):
        for page in [
            {"extract": "An American musician."},
            {"extract": "Basketball may refer to", "pageprops": {"disambiguation": ""}},
        ]:
            page["thumbnail"] = {"source": "https://upload.wikimedia.org/unrelated.jpg"}
            self.assertIsNone(self.lookup(page))

    def test_external_image_host_rejected(self):
        self.assertIsNone(self.lookup({"extract": "A basketball player.",
                                       "thumbnail": {"source": "https://example.com/photo.jpg"}}))
