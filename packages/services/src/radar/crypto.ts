const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEV_SECRET = "llmhub-radar-dev-secret-change-me";
const MIN_SECRET_LENGTH = 32;

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is not available in this runtime");
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    textEncoder.encode(input),
  );
  return new Uint8Array(digest);
}

async function hmacSha256Bytes(input: string): Promise<Uint8Array> {
  const key = await getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(textEncoder.encode(getCredentialSecret())),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await getCrypto().subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(textEncoder.encode(input)),
  );
  return new Uint8Array(signature);
}

async function getAesKey(): Promise<CryptoKey> {
  const secret = getCredentialSecret();
  const keyBytes = await sha256Bytes(secret);
  return getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" || process.env.SELF_HOST === "true"
  );
}

function getCredentialSecret() {
  const secret = process.env.RADAR_CREDENTIAL_SECRET?.trim();

  if (!secret) {
    if (isProductionRuntime()) {
      throw new Error(
        "RADAR_CREDENTIAL_SECRET is required in production. Generate it once, keep it stable across deployments, and store it outside Git.",
      );
    }
    return DEV_SECRET;
  }

  if (secret === DEV_SECRET) {
    throw new Error(
      "RADAR_CREDENTIAL_SECRET must not use the development default value.",
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `RADAR_CREDENTIAL_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
    );
  }

  return secret;
}

export async function encryptSecret(plainText: string): Promise<string> {
  const webCrypto = getCrypto();
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await getAesKey();
  const cipher = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(textEncoder.encode(plainText)),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [version, iv, cipher] = payload.split(".");
  if (version !== "v1" || !iv || !cipher) {
    throw new Error("Invalid encrypted payload");
  }
  const key = await getAesKey();
  const plain = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(iv)) },
    key,
    toArrayBuffer(base64ToBytes(cipher)),
  );
  return textDecoder.decode(plain);
}

export async function hashSecret(input: string): Promise<string> {
  return bytesToBase64(await sha256Bytes(input)).slice(0, 64);
}

export async function hashPrivateIdentifier(input: string): Promise<string> {
  return bytesToBase64(await hmacSha256Bytes(input)).slice(0, 64);
}

export function getSecretLastFour(input: string): string {
  return input.slice(-4);
}
