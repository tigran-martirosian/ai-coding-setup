#!/usr/bin/env node
// limits.mjs: checks every candidate of a hunt against the hard limits before the table is written.
//   node tools/limits.mjs finds/sources/<topic>
// Reads limits.json and candidates.json in that folder, prints what stays and what is dropped and
// why, and writes checked.json (the link gate reads it).
//
// limits.json (written at pin-down; leave out a limit that does not apply):
//   { "request": "one line", "max_price": 150, "max_weight": 20, "weight_unit": "kg", "quantity": 1,
//     "max_distance": 40, "distance_unit": "km", "banned": ["electric", "plastic body"], "minutes": 10 }
// candidates.json (one row per page that was opened; null = looked for and not found):
//   [ { "name": "...", "url": "...", "price": 62.5, "weight": null, "min_order": 1,
//       "distance": null, "kind": "hand mill, cast iron", "state": "live" } ]
//   price = delivered, in the user's currency. weight and distance in the units named in limits.json
//   (the ones in profile.md). distance only for pickup. state: live, gone or unclear.
import fs from "node:fs";
import path from "node:path";
import { notAnItemPage } from "./links.mjs";

export function check(limits, rows) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const wu = limits.weight_unit ? ` ${limits.weight_unit}` : "", du = limits.distance_unit ? ` ${limits.distance_unit}` : "";
  const banned = (limits.banned || []).map((w) => [w, new RegExp(`(?<![\\p{L}\\p{N}])${String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")}`, "iu")]);
  const tally = {};
  const out = rows.map((r) => {
    const reasons = [], unknown = [];
    const drop = (group, text) => { reasons.push(text); tally[group] = (tally[group] || 0) + 1; };
    if (!r.url) drop("no link", "no link: not opened");
    else if (notAnItemPage(r.url)) drop("not an item page", `the link is ${notAnItemPage(r.url)}`);
    if (r.state !== "live") drop(r.state === "gone" ? "sold or gone" : "not confirmed live", r.state === "gone" ? "sold or gone" : `state is "${r.state ?? "missing"}", not confirmed live`);
    const price = num(r.price), weight = num(r.weight), min = num(r.min_order), dist = num(r.distance);
    if (num(limits.max_price) !== null) {
      if (price === null) unknown.push("price not found");
      else if (price > limits.max_price) drop("price", `${price} is over the ${limits.max_price} limit`);
    }
    if (num(limits.max_weight) !== null) {
      if (weight === null) unknown.push("weight not found");
      else if (weight > limits.max_weight) drop("weight", `${weight}${wu} is over ${limits.max_weight}${wu}`);
    }
    if (num(limits.quantity) !== null && min !== null && min > limits.quantity) drop("minimum order", `minimum order is ${min}, wanted ${limits.quantity}`);
    if (num(limits.max_distance) !== null && dist !== null && dist > limits.max_distance) drop("distance", `${dist}${du} is over ${limits.max_distance}${du}`);
    const hay = `${r.name || ""} ${r.kind || ""}`;
    for (const [word, re] of banned) if (re.test(hay)) drop(`banned kind (${word})`, `banned kind: ${word}`);
    return { name: r.name || "(no name)", url: r.url || "", ok: reasons.length === 0, reasons, unknown };
  });
  const dropped = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} for ${k}`).join(", ");
  return { rows: out, kept: out.filter((r) => r.ok), line: dropped ? `Dropped: ${dropped}.` : "Dropped: none." };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const dir = process.argv[2];
  if (!dir) { console.log("Usage: node tools/limits.mjs finds/sources/<topic>"); process.exit(2); }
  let limits, rows;
  try {
    limits = JSON.parse(fs.readFileSync(path.join(dir, "limits.json"), "utf8"));
    rows = JSON.parse(fs.readFileSync(path.join(dir, "candidates.json"), "utf8"));
    if (!Array.isArray(rows)) throw new Error("candidates.json must be a list");
  } catch (e) { console.log(`Cannot read limits.json and candidates.json in ${dir}: ${e.message}`); process.exit(2); }
  const res = check(limits, rows);
  fs.writeFileSync(path.join(dir, "checked.json"), JSON.stringify({ checkedAt: new Date().toISOString(), limits, rows: res.rows }, null, 1));
  const lim = [limits.max_price != null && `at most ${limits.max_price} delivered`, limits.max_weight != null && `at most ${limits.max_weight} ${limits.weight_unit || ""}`.trim(),
    limits.quantity != null && `${limits.quantity} unit(s)`, limits.max_distance != null && `pickup within ${limits.max_distance} ${limits.distance_unit || ""}`.trim(),
    limits.banned?.length && `never: ${limits.banned.join(", ")}`].filter(Boolean).join("; ");
  console.log(`Limits: ${lim}`);
  console.log(`\nMeets every limit: ${res.kept.length} of ${rows.length}`);
  for (const r of res.kept) console.log(`- ${r.name}${r.unknown.length ? ` [${r.unknown.join(", ")}: say so in the table]` : ""} | ${r.url}`);
  console.log(`\n${res.line}`);
  for (const r of res.rows.filter((x) => !x.ok)) console.log(`- ${r.name}: ${r.reasons.join("; ")}`);
  console.log(`\nPut the "Dropped:" line in the answer. Only the ${res.kept.length} above go in the main table; a dropped one may be shown only under "ruled out" or with what it breaks.`);
  if (!res.kept.length) console.log("Nothing meets every limit: say that in the first line, with the real choices.");
}
