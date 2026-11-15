"""python3 -m unittest discover -s deploy/vps-monitor -p 'test_donations.py'"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import donations  # noqa: E402

SCHEMA = """
CREATE TABLE donation_sessions (ref TEXT PRIMARY KEY, email TEXT NOT NULL, chain_id INTEGER NOT NULL, token TEXT NOT NULL,
  amount TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE donations (payment_id TEXT PRIMARY KEY, ref TEXT, email TEXT, chain_id INTEGER NOT NULL, token_symbol TEXT NOT NULL,
  token_address TEXT NOT NULL, amount TEXT NOT NULL, tx_hashes TEXT NOT NULL, notified TEXT NOT NULL DEFAULT 'pending',
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')), test INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'checkout', thanked_at TEXT, thank_note TEXT);
"""
TX = "0x" + "ab" * 32


class Donations(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "hiraia.db")
        os.environ["HIRAIA_DB_PATH"] = self.path
        db = sqlite3.connect(self.path)
        db.executescript(SCHEMA)
        db.execute("INSERT INTO donations (payment_id, email, chain_id, token_symbol, token_address, amount, tx_hashes, notified) VALUES (?,?,?,?,?,?,?,?)",
                   ("p1", "donor@example.test", 1, "USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", "25", json.dumps([{"chainId": 1, "transactionHash": TX}]), "email"))
        db.execute("INSERT INTO donations (payment_id, email, chain_id, token_symbol, token_address, amount, tx_hashes, notified) VALUES (?,?,?,?,?,?,?,?)",
                   ("p2", None, 8453, "USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0.5", json.dumps([{"chainId": 8453, "transactionHash": "not-a-hash"}]), "beaniebot"))
        db.commit()
        db.close()

    def tearDown(self):
        self.dir.cleanup()

    def test_listing_projects_rows(self):
        out = donations.listing()
        self.assertTrue(out["ok"])
        by_id = {d["id"]: d for d in out["donations"]}
        self.assertEqual(by_id["p1"]["network"], "Ethereum")
        self.assertEqual(by_id["p1"]["tx_url"], f"https://etherscan.io/tx/{TX}")
        self.assertEqual(by_id["p1"]["source"], "checkout")
        self.assertIsNone(by_id["p2"]["email"])
        self.assertIsNone(by_id["p2"]["tx"])  # malformed hashes are dropped, never linked

    def test_thanked_toggle_and_note(self):
        code, body = donations.set_thanked({"payment_id": "p1", "thanked": True, "note": "  emailed 15 Nov  "})
        self.assertEqual(code, 200)
        self.assertTrue(body["donation"]["thanked_at"])
        self.assertEqual(body["donation"]["thank_note"], "emailed 15 Nov")
        first = body["donation"]["thanked_at"]
        code, body = donations.set_thanked({"payment_id": "p1", "thanked": True, "note": "x" * 900})
        self.assertEqual(body["donation"]["thanked_at"], first)  # editing the note keeps the date
        self.assertEqual(len(body["donation"]["thank_note"]), donations.NOTE_MAX)
        code, body = donations.set_thanked({"payment_id": "p1", "thanked": False, "note": ""})
        self.assertIsNone(body["donation"]["thanked_at"])

    def test_rejections(self):
        self.assertEqual(donations.set_thanked({"payment_id": "p2", "thanked": True})[0], 409)  # anonymous
        self.assertEqual(donations.set_thanked({"payment_id": "nope", "thanked": True})[0], 404)
        self.assertEqual(donations.set_thanked({"payment_id": "p1", "thanked": "yes"})[0], 400)
        self.assertEqual(donations.set_thanked({"payment_id": "", "thanked": True})[0], 400)

    def test_retention_on_read(self):
        db = sqlite3.connect(self.path)
        db.execute("UPDATE donations SET thank_note='n', confirmed_at=datetime('now','-181 days') WHERE payment_id='p1'")
        db.execute("INSERT INTO donation_sessions (ref,email,chain_id,token,amount,created_at) VALUES ('r','a@b.co',1,'USDT','25',datetime('now','-8 days'))")
        db.commit()
        db.close()
        out = donations.listing()
        p1 = next(d for d in out["donations"] if d["id"] == "p1")
        self.assertIsNone(p1["email"])
        self.assertEqual(p1["thank_note"], "")
        self.assertEqual(out["pending_sessions"], 0)

    def test_missing_db_and_page(self):
        os.environ["HIRAIA_DB_PATH"] = os.path.join(self.dir.name, "absent.db")
        self.assertEqual(donations.api_response()[0], 503)
        html = donations.page("/admin", "csrf-token")
        self.assertIn('aria-current="page">Donations</a>', html)
        self.assertIn("HiraiaDonations.mount", html)


if __name__ == "__main__":
    unittest.main()
