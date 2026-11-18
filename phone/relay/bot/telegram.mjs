// The Bot API over a fetch the caller gives: worker.mjs passes the platform's fetch, the tests a stand-in, so no
// test reaches Telegram. The token only builds the call address; it is never logged or put in an error.
//   telegramApi({ token, fetch }) -> { telegram(method, params), upload(method, { body, length, type }),
//   download(filePath) }, the Hub's three calls.

const TOKEN = /^\d+:[A-Za-z0-9_-]+$/;
const FILE_PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function telegramApi({ token, fetch }) {
  if (typeof token !== "string" || !TOKEN.test(token))
    throw new Error("telegram: the bot token is missing or not <id>:<key>");
  if (typeof fetch !== "function")
    throw new Error("telegram: a fetch function must be given");
  const base = "https://api.telegram.org";

  return {
    async telegram(method, params) {
      if (!/^[A-Za-z]+$/.test(method))
        throw new Error(`telegram: bad method name ${String(method)}`);
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(`telegram ${method}: ${body.description}`);
      return body.result;
    },

    // A call whose body the caller builds and streams: `length` bytes of Content-Type `type` (sendDocument's
    // multipart). A refusal throws "telegram <method>: <description>", as telegram() does.
    async upload(method, { body, length, type }) {
      if (!/^[A-Za-z]+$/.test(method))
        throw new Error(`telegram: bad method name ${String(method)}`);
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": type, "Content-Length": String(length) },
        body,
        duplex: "half",
      });
      const out = await res.json();
      if (!out.ok) throw new Error(`telegram ${method}: ${out.description}`);
      return out.result;
    },

    async download(filePath) {
      if (typeof filePath !== "string" || !FILE_PATH.test(filePath))
        throw new Error("telegram file download: bad file path");
      if (filePath.split("/").includes(".."))
        throw new Error("telegram file download: bad file path");
      const res = await fetch(`${base}/file/bot${token}/${filePath}`);
      if (!res.ok) throw new Error(`telegram file download: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
