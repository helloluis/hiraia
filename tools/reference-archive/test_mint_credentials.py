"""No real credentials or network: independently check JWT and file guarantees."""
import base64
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import archive
import mint_credentials as mint


class CredentialsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.state = self.root / "build/reference-archive"
        self.patch = patch.object(mint, "DEFAULT_STATE", self.state)
        self.patch.start()
        self.values = {"R2_ENDPOINT": "https://" + "a" * 32 + ".r2.cloudflarestorage.com",
                       "R2_ACCESS_KEY_ID": "fixture-parent-access", "R2_SECRET_ACCESS_KEY": "fixture-parent-secret"}
        self.parent = self.root / "parent.env"
        self.parent.write_text("".join(f"{key}={value}\n" for key, value in self.values.items()))

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(archive.ArchiveError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def decode(self, credentials):
        raw = base64.b64decode(credentials["R2_SESSION_TOKEN"]).decode("ascii")
        self.assertTrue(raw.startswith("jwt/"))
        token = raw[4:]
        parts = token.split(".")
        decode = lambda part: base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        return token, parts, json.loads(decode(parts[0])), json.loads(decode(parts[1])), decode(parts[2])

    def test_read_only_scope_signature_derivation_and_expiry(self):
        credentials, metadata = mint.derive_credentials(self.values, "hiraia-archive", now=1800000000)
        token, parts, header, claims, signature = self.decode(credentials)
        self.assertEqual(header, {"alg": "HS256", "typ": "JWT"})
        self.assertEqual(claims["scope"], "object-read-only")
        self.assertEqual(claims["bucket"], "hiraia-archive")
        self.assertEqual(claims["paths"], {"prefixPaths": ["objects/sha256/", "snapshots/"], "objectPaths": []})
        self.assertEqual(set(claims), {"bucket", "scope", "paths", "sub", "iss", "aud", "iat", "exp"})
        self.assertEqual(claims["sub"], "a" * 32)
        self.assertEqual(claims["iss"], self.values["R2_ACCESS_KEY_ID"])
        self.assertEqual(claims["aud"], self.values["R2_ENDPOINT"][8:])
        self.assertEqual(claims["iat"], 1800000000)
        self.assertEqual(claims["exp"], 1800021600)
        expected = hmac.new(self.values["R2_SECRET_ACCESS_KEY"].encode(), ".".join(parts[:2]).encode(), hashlib.sha256).digest()
        self.assertTrue(hmac.compare_digest(signature, expected))
        self.assertEqual(credentials["R2_SECRET_ACCESS_KEY"], hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(credentials["R2_ACCESS_KEY_ID"], self.values["R2_ACCESS_KEY_ID"])
        self.assertNotIn("fixture-parent", json.dumps(metadata))

    def test_explicit_upload_and_ttl_boundaries(self):
        credentials, _ = mint.derive_credentials(self.values, "hiraia-archive", upload=True, ttl_seconds=86400, now=100)
        self.assertEqual(self.decode(credentials)[3]["scope"], "object-read-write")
        self.assertEqual(self.decode(credentials)[3]["exp"], 86500)
        mint.derive_credentials(self.values, "hiraia-archive", ttl_seconds=1)
        for value in (0, -1, 86401, 1.5, True):
            self.assert_code("invalid_ttl", mint.derive_credentials, self.values, "hiraia-archive", ttl_seconds=value)
        self.assert_code("invalid_scope", mint.derive_credentials, self.values, "hiraia-archive", upload="yes")

    def test_account_endpoint_validation_and_jurisdiction_audience(self):
        values = dict(self.values, CLOUDFLARE_ACCOUNT_ID="a" * 32)
        values.pop("R2_ENDPOINT")
        self.assertEqual(mint.derive_credentials(values, "hiraia-archive")[0]["R2_ENDPOINT"], self.values["R2_ENDPOINT"])
        values["R2_ENDPOINT"] = "https://" + "a" * 32 + ".eu.r2.cloudflarestorage.com/"
        credentials, _ = mint.derive_credentials(values, "hiraia-archive")
        self.assertEqual(self.decode(credentials)[3]["aud"], "a" * 32 + ".eu.r2.cloudflarestorage.com")
        self.assert_code("account_mismatch", mint.derive_credentials,
                         dict(self.values, CLOUDFLARE_ACCOUNT_ID="b" * 32), "hiraia-archive")
        for endpoint in ("http://" + "a" * 32 + ".r2.cloudflarestorage.com", self.values["R2_ENDPOINT"] + "/bucket",
                         self.values["R2_ENDPOINT"] + "?secret=value", "https://attacker.r2.cloudflarestorage.com",
                         self.values["R2_ENDPOINT"] + ":443"):
            self.assert_code("invalid_endpoint", mint.derive_credentials, dict(self.values, R2_ENDPOINT=endpoint), "hiraia-archive")

    def test_private_exclusive_output_and_redacted_success(self):
        output = self.state / "credentials/read.env"
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            result = mint.main(["--env-file", str(self.parent), "--output", str(output), "--bucket", "hiraia-archive"])
        self.assertEqual(result, 0)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        content = output.read_text()
        self.assertIn("R2_SESSION_TOKEN=", content)
        self.assertNotIn("fixture-parent-secret", content)
        self.assertNotIn("fixture-parent", out.getvalue() + err.getvalue())
        row = json.loads(out.getvalue())
        self.assertEqual(row["scope"], "object-read-only")
        self.assertEqual(row["ttl_seconds"], 21600)
        with patch.object(mint, "parse_parent") as read:
            self.assert_code("output_exists", mint.mint, self.parent, output, "hiraia-archive")
        read.assert_not_called()
        self.assertEqual(output.read_text(), content)
        self.assertFalse(list(output.parent.glob(".credentials-*")))

    def test_unsafe_output_public_bucket_and_expiry_refused_before_secret_read(self):
        for path in (self.root / "tracked.env", self.state / "../escaped.env"):
            with patch.object(mint, "parse_parent") as read:
                self.assert_code("unsafe_output", mint.mint, self.parent, path, "hiraia-archive")
            read.assert_not_called()
        with patch.object(mint, "parse_parent") as read:
            self.assert_code("public_bucket_refused", mint.mint, self.parent, self.state / "new.env", "hiraia-assets")
            self.assert_code("invalid_ttl", mint.mint, self.parent, self.state / "new.env", "hiraia-archive", ttl_seconds=86401)
        read.assert_not_called()

    def test_symlink_output_or_ancestor_is_refused(self):
        self.state.mkdir(parents=True)
        (self.state / "linked").symlink_to(self.root, target_is_directory=True)
        self.assert_code("unsafe_output", mint.mint, self.parent, self.state / "linked/out.env", "hiraia-archive")
        (self.state / "file.env").symlink_to(self.root / "nonexistent")
        self.assert_code("unsafe_output", mint.mint, self.parent, self.state / "file.env", "hiraia-archive")

    def test_racing_destination_is_preserved_and_temporary_secret_removed(self):
        output = self.state / "race.env"
        real_link = os.link

        def race(*args, **kwargs):
            output.write_bytes(b"another writer")
            return real_link(*args, **kwargs)

        with patch.object(mint.os, "link", side_effect=race):
            self.assert_code("output_exists", mint.mint, self.parent, output, "hiraia-archive")
        self.assertEqual(output.read_bytes(), b"another writer")
        self.assertFalse(list(output.parent.glob(".credentials-*")))

    def test_failure_does_not_echo_secret_exception(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(mint, "parse_parent", side_effect=OSError("fixture-parent-secret")), redirect_stdout(out), redirect_stderr(err):
            code = mint.main(["--env-file", str(self.parent), "--output", str(self.state / "failure.env"), "--bucket", "hiraia-archive"])
        self.assertEqual(code, 1)
        self.assertNotIn("fixture-parent", out.getvalue() + err.getvalue())
        self.assertEqual(json.loads(out.getvalue())["error"]["code"], "local_failure")

    def test_temporary_parent_and_duplicate_values_are_refused(self):
        self.parent.write_text(self.parent.read_text() + "R2_SESSION_TOKEN=fixture-session\n")
        self.assert_code("temporary_parent_refused", mint.parse_parent, self.parent)
        self.parent.write_text("R2_ACCESS_KEY_ID=one\nR2_ACCESS_KEY_ID=two\n")
        self.assert_code("ambiguous_parent", mint.parse_parent, self.parent)


if __name__ == "__main__":
    unittest.main()
