// The page check (pipe design, section 6): the PC fetches every page file the relay serves and compares its
// SHA-256 with page-hashes.json, the PC's own build of its own version. Any difference, a missing file or another
// version marks the page "unverified": then only pc.status answers.
import { sha256, toHex } from "../../../../phone/shared/seal.mjs";
import { pageHashesPath, readText } from "./files.mjs";
import { log } from "./log.mjs";

// Returns { page: "ok" | "unverified", differ: [paths] }.
export async function checkPage(relay, setupVersion) {
  let list;
  try {
    list = JSON.parse(readText(pageHashesPath()));
  } catch (e) {
    log(
      "page-check",
      `unverified: no readable page list (${e.code || "bad JSON"})`,
    );
    return { page: "unverified", differ: ["page-hashes.json"] };
  }
  const differ = [];
  if (list.version !== setupVersion) differ.push("version");
  for (const [p, want] of Object.entries(list.files || {})) {
    let got = null;
    try {
      const res = await fetch(new URL(p, relay), {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok)
        got = toHex(await sha256(new Uint8Array(await res.arrayBuffer())));
    } catch {
      got = null;
    }
    if (got !== want) differ.push(p);
  }
  if (!Object.keys(list.files || {}).length) differ.push("no files listed");
  const page = differ.length ? "unverified" : "ok";
  log("page-check", page === "ok" ? "ok" : `unverified: ${differ.join(" ")}`);
  return { page, differ };
}
