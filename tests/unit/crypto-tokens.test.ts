import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptToken, encryptToken, getEncryptionKey, signState, verifyState } from "@/lib/crypto/tokens";
import { resetEnvCache } from "@/lib/env";

const KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  resetEnvCache();
});

afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  resetEnvCache();
});

describe("cifrado de tokens", () => {
  it("descifra lo que cifró", () => {
    const secret = "ya29.token-de-prueba";
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("produce cifrados distintos para el mismo texto", () => {
    expect(encryptToken("mismo")).not.toBe(encryptToken("mismo"));
  });

  it("detecta manipulación del texto cifrado", () => {
    const [iv, tag, data] = encryptToken("token").split(".");
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 0xff;
    expect(() => decryptToken([iv, tag, tampered.toString("base64")].join("."))).toThrow();
  });

  it("rechaza un formato inválido", () => {
    expect(() => decryptToken("sin-puntos")).toThrow(/formato inválido/);
  });

  it("rechaza claves que no midan 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    resetEnvCache();
    expect(() => getEncryptionKey()).toThrow(/32 bytes/);
  });
});

describe("estado de OAuth", () => {
  it("recupera el contenido firmado", () => {
    const payload = JSON.stringify({ profileId: "abc", nonce: "n", issuedAt: 1 });
    expect(verifyState(signState(payload))).toBe(payload);
  });

  it("falla con un estado ajeno", () => {
    const otherKey = Buffer.from(randomBytes(32));
    const foreign = encryptToken("payload", otherKey);
    expect(() => verifyState(foreign)).toThrow();
  });
});
