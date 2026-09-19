package expo.modules.hiraiatala;

import android.util.Base64;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/** Matches packages/tala ClassIdentity: RSA-OAEP SHA-256/MGF1-SHA1, AES-256-GCM 128-bit tag. */
public final class TalaCrypto {
  private TalaCrypto() {}

  public static String encode(byte[] bytes) {
    return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
  }

  public static byte[] decode(String value) {
    return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP);
  }

  public static Map<String, String> encryptRequest(String publicKeyB64, String challenge, String plaintext)
      throws Exception {
    PublicKey publicKey =
        KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(decode(publicKeyB64)));
    byte[] aes = new byte[32];
    new SecureRandom().nextBytes(aes);
    Cipher wrapping = Cipher.getInstance("RSA/ECB/OAEPPadding");
    wrapping.init(
        Cipher.ENCRYPT_MODE,
        publicKey,
        new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT));
    byte[] wrapped = wrapping.doFinal(aes);
    byte[] nonce = new byte[12];
    new SecureRandom().nextBytes(nonce);
    Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
    gcm.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aes, "AES"), new GCMParameterSpec(128, nonce));
    gcm.updateAAD(challenge.getBytes("UTF-8"));
    byte[] ciphertext = gcm.doFinal(plaintext.getBytes("UTF-8"));
    Map<String, String> out = new HashMap<>();
    out.put("wrapped_key", encode(wrapped));
    out.put("nonce", encode(nonce));
    out.put("ciphertext", encode(ciphertext));
    out.put("session_key", encode(aes));
    return out;
  }

  public static byte[] randomBytes(int n) {
    byte[] out = new byte[n];
    new SecureRandom().nextBytes(out);
    return out;
  }

  public static byte[] sha256(byte[] input) throws Exception {
    return MessageDigest.getInstance("SHA-256").digest(input);
  }

  public static byte[] hmacSha256(byte[] key, byte[] message) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return mac.doFinal(message);
  }

  public static String decryptAesGcm(String keyB64, String nonceB64, String aadB64, String ciphertextB64)
      throws Exception {
    byte[] nonce = decode(nonceB64);
    if (nonce.length != 12) throw new IllegalArgumentException("nonce");
    Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
    gcm.init(Cipher.DECRYPT_MODE, new SecretKeySpec(decode(keyB64), "AES"), new GCMParameterSpec(128, nonce));
    gcm.updateAAD(decode(aadB64));
    return new String(gcm.doFinal(decode(ciphertextB64)), "UTF-8");
  }

  public static String decryptResponse(String sessionKeyB64, String challenge, String nonceB64, String ciphertextB64)
      throws Exception {
    byte[] nonce = decode(nonceB64);
    if (nonce.length != 12) throw new IllegalArgumentException("nonce");
    Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
    gcm.init(
        Cipher.DECRYPT_MODE,
        new SecretKeySpec(decode(sessionKeyB64), "AES"),
        new GCMParameterSpec(128, nonce));
    gcm.updateAAD(challenge.getBytes("UTF-8"));
    return new String(gcm.doFinal(decode(ciphertextB64)), "UTF-8");
  }
}
