import { describe, expect, it } from "vitest";
import {
  ContentDecryptionError,
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  generateContentKey,
  unwrapContentKey,
  wrapContentKey,
} from "./encryption.js";

const WRAP_SECRET = "test-wrap-secret-at-least-16-chars";

describe("content encryption", () => {
  it("round-trips a post body", () => {
    const key = generateContentKey();
    const payload = encryptText("subscriber-only words", key);
    expect(payload.algorithm).toBe("AES-256-GCM");
    expect(decryptText(payload, key)).toBe("subscriber-only words");
  });

  it("round-trips arbitrary media bytes", () => {
    const key = generateContentKey();
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 42]);
    const payload = encryptBytes(bytes, key);
    expect(new Uint8Array(decryptBytes(payload, key))).toEqual(bytes);
  });

  it("produces a fresh IV per call (no nonce reuse)", () => {
    const key = generateContentKey();
    const a = encryptText("same text", key);
    const b = encryptText("same text", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails authentication with the wrong key", () => {
    const payload = encryptText("secret", generateContentKey());
    expect(() => decryptText(payload, generateContentKey())).toThrow(ContentDecryptionError);
  });

  it("fails authentication when the ciphertext is tampered with", () => {
    const key = generateContentKey();
    const payload = encryptText("secret", key);
    const bytes = Buffer.from(payload.ciphertext, "base64");
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
    expect(() => decryptText({ ...payload, ciphertext: bytes.toString("base64") }, key)).toThrow(
      ContentDecryptionError,
    );
  });

  it("envelope-wraps and unwraps a content key", () => {
    const key = generateContentKey();
    const wrapped = wrapContentKey(key, WRAP_SECRET);
    expect(wrapped).not.toContain(key.toString("base64"));
    expect(unwrapContentKey(wrapped, WRAP_SECRET).equals(key)).toBe(true);
  });

  it("cannot unwrap with a different wrap secret", () => {
    const wrapped = wrapContentKey(generateContentKey(), WRAP_SECRET);
    expect(() => unwrapContentKey(wrapped, "another-wrap-secret-16-plus")).toThrow(ContentDecryptionError);
  });

  it("rejects a too-short wrap secret", () => {
    expect(() => wrapContentKey(generateContentKey(), "short")).toThrow();
  });
});
