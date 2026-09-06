import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const stable = (value) => JSON.stringify(value, Object.keys(value).sort());

// TESTNET ONLY. Ed25519 is used as a portable bootstrap signature. The crypto
// provider boundary makes ML-DSA/FIPS-204 replacement possible before mainnet.
export const cryptoProvider = {
  algorithm: "Ed25519-testnet",
  createWallet() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    return {
      address: `krk1${sha256(publicPem).slice(0, 40)}`,
      publicKey: publicPem,
      privateKey: privatePem,
    };
  },
  sign(message, privateKey) {
    return sign(null, Buffer.from(message), privateKey).toString("base64");
  },
  verify(message, signature, publicKey) {
    return verify(null, Buffer.from(message), publicKey, Buffer.from(signature, "base64"));
  },
};
