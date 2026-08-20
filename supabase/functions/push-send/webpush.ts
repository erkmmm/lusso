// Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) on top of WebCrypto.
// Deliberately dependency-free: npm:web-push drags in node crypto shims, and all
// we need is one ECDH, a few HKDF steps, an AES-GCM seal and an ES256 JWT.

const enc = new TextEncoder()

export const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const bytesToB64url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const concat = (...arrs: Uint8Array[]) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}

// HKDF, spelled out — one extract, one 32-byte expand, which is all Web Push uses.
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm))
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const out = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))))
  return out.slice(0, len)
}

/** Encrypt `payload` for one subscription. Returns the aes128gcm request body. */
export async function encryptPayload(payload: string, p256dh: string, authSecret: string) {
  const uaPublic = b64urlToBytes(p256dh)          // 65 bytes, 0x04 || X || Y
  const auth = b64urlToBytes(authSecret)          // 16 bytes

  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey))

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, [])
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256),
  )

  // RFC 8291 §3.4: the auth secret salts the key-material step, and the info
  // string binds the derived key to *this* pair of public keys.
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic)
  const ikm = await hkdf(auth, shared, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12)

  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"])
  // 0x02 is the delimiter marking this as the last (only) record — no padding.
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, plaintext),
  )

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

/** VAPID `Authorization: vapid t=<jwt>, k=<pub>` header for one push origin. */
export async function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const aud = new URL(endpoint).origin
  const pub = b64urlToBytes(publicKey)
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: privateKey,
    ext: true,
  }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])

  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject,
  })))
  const signing = `${header}.${claims}`
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signing)),
  )
  return `vapid t=${signing}.${bytesToB64url(sig)}, k=${publicKey}`
}
