import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getEnv } from "@/lib/env";

/**
 * Cifrado simétrico de tokens de terceros con AES-256-GCM.
 * TOKEN_ENCRYPTION_KEY debe ser de 32 bytes codificados en Base64.
 * Formato de salida: base64(iv).base64(authTag).base64(ciphertext)
 */

const IV_BYTES = 12;

export function getEncryptionKey(): Buffer {
  const raw = getEnv().TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Falta TOKEN_ENCRYPTION_KEY.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY debe ser de 32 bytes codificados en Base64.");
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptToken(payload: string, key: Buffer = getEncryptionKey()): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Token cifrado con formato inválido.");

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]).toString("utf8");
}

/** Firma el parámetro `state` de OAuth para detectar CSRF. */
export function signState(payload: string, key: Buffer = getEncryptionKey()): string {
  return encryptToken(payload, key);
}

export function verifyState(state: string, key: Buffer = getEncryptionKey()): string {
  return decryptToken(state, key);
}
