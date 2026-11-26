// Telegram's start data (initData) as a Mini App gets it, signed both ways Telegram signs it: `signature`, Ed25519
// over "<botId>:WebAppData\n" and the sorted fields without hash and signature (checked without the bot token), and
// `hash`, the hex HMAC-SHA-256 of the sorted fields without hash (signature included) under
// HMAC_SHA256("WebAppData", botToken) (Mini Apps, "Validating data received via the Mini App").
//   await signInitData({ fields, botId, botToken, privateKey }) -> "auth_date=…&user=…&signature=…&hash=…"
import { createHmac } from "node:crypto";

const sorted = (fields) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

// fields: the plain fields (auth_date, query_id, user); privateKey: the test's stand-in for Telegram's Ed25519 key.
export async function signInitData({ fields, botId, botToken, privateKey }) {
  const sig = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(`${botId}:WebAppData\n${sorted(fields)}`),
  );
  const signed = {
    ...fields,
    signature: Buffer.from(sig).toString("base64url"),
  };
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret)
    .update(sorted(signed))
    .digest("hex");
  return new URLSearchParams({ ...signed, hash }).toString();
}

// The same start data without `hash`: what a page sends in a pairing frame, so the PC never holds a relay login.
export const withoutHash = (initData) => {
  const p = new URLSearchParams(initData);
  p.delete("hash");
  return p.toString();
};
