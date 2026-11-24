"""Unit tests (no models needed):  python3 -B -m unittest deploy/voice-demo/test_server.py
Frontend fuzz (needs the bundle venv):  VOICE_DEMO_BUNDLE=... python -m unittest ... (FrontendFuzz)."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402
from server import UserError, chunks, normalise  # noqa: E402


class Normalise(unittest.TestCase):
    def test_keeps_taglish_and_hyphenated_words(self):
        self.assertEqual(normalise("Kapag mainit, nag-e-evaporate ang water.", "fil"),
                         "Kapag mainit, nag-e-evaporate ang water.")

    def test_strips_quotes_brackets_emoji_and_maps_dashes(self):
        self.assertEqual(normalise('“Hello” (world) 😀 — yes', "en"), "Hello world, yes")

    def test_newlines_become_sentence_ends(self):
        self.assertEqual(normalise("Una\nIkalawa", "fil"), "Una. Ikalawa")

    def test_ampersand_spoken_per_voice(self):
        self.assertEqual(normalise("ako & ikaw", "fil"), "ako at ikaw")
        self.assertEqual(normalise("you & me", "en"), "you and me")

    def test_digits_rejected_with_spelling_hint(self):
        with self.assertRaises(UserError) as ctx:
            normalise("May 7 planeta", "fil")
        self.assertEqual(ctx.exception.code, "digits")

    def test_cap_and_empty(self):
        with self.assertRaises(UserError) as ctx:
            normalise("a" * 501, "en")
        self.assertEqual(ctx.exception.status, 413)
        normalise("a" * 500, "en")
        for empty in ("", "   ", "...", "😀😀", "#@!"):
            with self.assertRaises(UserError):
                normalise(empty, "en")


class Chunks(unittest.TestCase):
    def test_sentences_and_bounds(self):
        text = "Una ito. Pangalawa ito? Oo! " + ", ".join(["salita"] * 80) + "."
        parts = chunks(text)
        self.assertEqual(parts[:3], ["Una ito.", "Pangalawa ito?", "Oo!"])
        self.assertTrue(all(len(p) <= server.CHUNK_CHARS + 1 for p in parts))
        self.assertEqual("".join(parts).replace(" ", "").replace(",", ""),
                         text.replace(" ", "").replace(",", ""))

    def test_unbroken_run_is_split(self):
        parts = chunks("a" * 500)
        self.assertTrue(all(len(p) <= server.CHUNK_CHARS for p in parts))
        self.assertEqual(sum(map(len, parts)), 500)


class Limits(unittest.TestCase):
    def test_per_client_minute_and_hour(self):
        r = server.RateLimiter()
        t = 1000.0
        for i in range(6):
            self.assertEqual(r.check("a", t + i), 0)
        self.assertGreater(r.check("a", t + 7), 0)
        self.assertEqual(r.check("b", t + 7), 0)  # other clients unaffected
        t2 = t
        for i in range(40 - 6):
            t2 += 61 if i % 6 == 0 else 1
            r.check("a", t2)
        self.assertGreater(r.check("a", t2 + 61), 0)  # hourly cap reached

    def test_hash_is_not_the_address(self):
        h = server.DailyHasher()
        self.assertNotIn("203.0.113.9", h("203.0.113.9"))
        self.assertEqual(h("203.0.113.9"), h("203.0.113.9"))


class BrandSpeechRewrites(unittest.TestCase):
    """hiraia.org URLs are spoken as words; visitor text is otherwise untouched."""

    def test_pinned_repo_lexicon_loads(self):
        repo = Path(__file__).resolve().parents[2] / "pronunciation" / "brand-lexicon.json"
        self.assertEqual(server.load_brand_lexicon(repo)["sha256"], server.BRAND_LEXICON_SHA256)

    def test_urls_spoken(self):
        cases = {
            "Visit Hiraia.org.": "Visit Hiraia-dot-org.",
            "Visit hiraia.org to download it.": "Visit Hiraia-dot-org to download it.",
            "HIRAIA.ORG": "Hiraia-dot-org",
            "https://hiraia.org/support": "Hiraia-dot-org support",
            "Go to https://www.hiraia.org now": "Go to www dot Hiraia-dot-org now",
            "assets.hiraia.org": "assets dot Hiraia-dot-org",
            "Bisitahin ang Hiraia.org, salamat!": "Bisitahin ang Hiraia-dot-org, salamat!",
        }
        for text, spoken in cases.items():
            for voice in ("fil", "en"):
                with self.subTest(text=text, voice=voice):
                    self.assertEqual(normalise(text, voice), spoken)

    def test_unrelated_text_unchanged(self):
        texts = ("Visit example.org today.", "notHiraia.org", "Hiraia org", "Ang tala sa langit.",
                 "Kapag mainit, nag-e-evaporate ang water.", "Visit https://example.org now")
        with_rewrites = [normalise(t, "en") for t in texts]
        saved, server.BRAND["rewrites"] = server.BRAND["rewrites"], []
        try:
            without = [normalise(t, "en") for t in texts]
        finally:
            server.BRAND["rewrites"] = saved
        self.assertEqual(with_rewrites, without)

    def test_length_cap_applies_to_visitor_text(self):
        text = ("hiraia.org " * 46)[:500]
        self.assertEqual(len(text), 500)
        self.assertGreater(len(normalise(text, "en")), 500)


@unittest.skipUnless(os.environ.get("VOICE_DEMO_BUNDLE"), "needs the voice bundle")
class BrandPronunciation(unittest.TestCase):
    """Every named term, both voices, plus capitalisation, punctuation and unaffected words."""

    @classmethod
    def setUpClass(cls):
        cls.engine = server.Engine(Path(os.environ["VOICE_DEMO_BUNDLE"]))
        from hiraia_voice.phoneme_frontend import PhonemeFrontend
        cls.frozen = PhonemeFrontend()

    def phones(self, text, voice, frontend=None):
        frontend = frontend or self.engine.frontend
        return " | ".join(frontend.prepare(p, server.VOICES[voice], label_mode="target",
                                           allow_provisional=True).phoneme_text
                          for p in chunks(normalise(text, voice)))

    EXPECTED = {
        "en": {"Hiraia": "hiːɹˈɑːjə", "Hiraia's": "hiːɹˈɑːjəz", "QVAC": "kjˈuːvæk", "Tala": "tˈɑːlə",
               "Luis Buenaventura": "luˈiːs bwˌɛnəvɛntˈʊɹə", "Tether": "tˈɛðɚ", "Qwen": "tʃwˈɛn",
               "DeepSeek": "dˈiːpsiːk", "Claude": "klˈɔːd", "ChatGPT": "tʃˈæt dʒˌiːpˌiːtˈiː",
               "Hiraia.org": "hiːɹˈɑːjə dˈɑːt ˈɔːɹɡ"},
        "fil": {"Hiraia": "hiɾˈaja", "Hiraia's": "hiɾˈajas", "QVAC": "kjˈuvak", "Tala": "tˈala",
                "Luis Buenaventura": "luˈis bwenaventˈuɾa", "Tether": "tˈɛdɛɾ", "Qwen": "tʃwˈɛn",
                "DeepSeek": "dˈipsik", "Claude": "klˈod", "ChatGPT": "tʃˈat dʒˌipitˈi",
                "Hiraia.org": "hiɾˈaja dˈɔt ˈɔɾɡ"},
    }

    def test_every_term_both_voices(self):
        import unicodedata
        for voice, terms in self.EXPECTED.items():
            for term, expected in terms.items():
                for variant in (term, term.upper(), term.lower(), f"({term})", f"{term}!", f"{term}, at"):
                    if voice == "en" and variant.endswith(", at"):
                        variant = f"{term}, and"
                    with self.subTest(voice=voice, variant=variant):
                        self.assertIn(unicodedata.normalize("NFD", expected), self.phones(variant, voice))

    def test_unaffected_text_identical_to_frozen_frontend(self):
        controls = {
            "fil": ["Ang paniki lang ang mammal sa buong mundo na talagang nakakalipad.",
                    "Isulat ang tala sa talaan.", "Ang Parañaque at Quezon ay nasa Metro Manila.",
                    "Kapag mainit, nag-e-evaporate ang water.", "Si Luisa ay may tuldok sa papel.", "May dot sa org."],
            "en": ["We call this change evaporation. Now, tell me what happened to the water.",
                   "Claudette tethered the boat in Manila.", "Talk to Luisa about the queue."],
        }
        for voice, texts in controls.items():
            for text in texts:
                with self.subTest(voice=voice, text=text):
                    self.assertEqual(self.phones(text, voice), self.phones(text, voice, self.frozen))

    def test_standalone_dot_and_org_untouched(self):
        # "Hiraia.org" is spoken through its own token; Lewis "dot" structures and the
        # astronaut-free word "org" keep the frozen pronunciation in both voices.
        for voice, text in (("fil", "Ang Lewis dot structure at ang org chart."), ("en", "A Lewis dot structure and an org chart.")):
            with self.subTest(voice=voice):
                self.assertEqual(self.phones(text, voice), self.phones(text, voice, self.frozen))


@unittest.skipUnless(os.environ.get("VOICE_DEMO_BUNDLE"), "needs the voice bundle")
class FrontendFuzz(unittest.TestCase):
    """Anything normalise() accepts must either prepare or raise a UserError, never crash."""

    def test_messy_inputs(self):
        engine = server.Engine(Path(os.environ["VOICE_DEMO_BUNDLE"]))
        samples = ['"Quoted" (paren) [br] {x}', "Line1\nLine2\tTab", "ñ Ñ é É ü", "#hashtag @mention & more",
                   "Ang DNA ay nasa cell.", "日本語テキスト", "Привет", "¿Qué?", "x – y", "it’s “smart” quotes",
                   "O₂ at CO₂", "Visit https://hiraia.org now", "— leading dash", "trailing -", "a" * 500,
                   "Hello… world!!!", "Parañaque at Las Piñas", "sige,,, ;; ok", "§ ¶ † • · ‰ ok",
                   "Alam mo ba? Ang photosynthesis ay paraan ng mga halaman."]
        for voice in ("fil", "en"):
            for s in samples:
                with self.subTest(voice=voice, text=s[:30]):
                    try:
                        pcm, parts = engine.synthesize(normalise(s, voice), voice, 1e18)
                        self.assertGreater(len(pcm), 0)
                    except UserError as e:
                        self.assertIn(e.status, (413, 422))


if __name__ == "__main__":
    unittest.main()
