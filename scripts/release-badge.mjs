// Writes docs/img/badge-release.svg, the README's "release vX" badge, from version.json. The badge is a file in the
// repo because GitHub shows a README's web pictures through its image proxy, which gives up after 4 s, and
// shields.io often takes longer for a picture the proxy has not cached yet (2026-11-26: a broken box on GitHub).
// Run: node scripts/release-badge.mjs   (step 2 of a release; tests/test-docs-clean.mjs fails when it is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(join(root, "version.json"), "utf8"),
).version;
if (!/^\d+(\.\d+)+$/.test(version ?? ""))
  throw new Error(`version.json version is not a version: ${version}`);

// Shields' layout: text sizes in tenths of a pixel; "release" is 390 wide, a version character about 61.
const value = `v${version}`;
const labelW = 49;
const valueText = Math.round(value.length * 61.4);
const valueW = Math.round(valueText / 10) + 10;
const width = labelW + valueW;
const valueX = labelW * 10 + (valueW * 10) / 2;
const text = (x, len, s) =>
  `<g transform="scale(.1)"><g aria-hidden="true" fill="#010101"><text x="${x}" y="150" fill-opacity=".8" filter="url(#blur)" textLength="${len}">${s}</text><text x="${x}" y="150" fill-opacity=".3" textLength="${len}">${s}</text></g><text x="${x}" y="140" textLength="${len}">${s}</text></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="release: ${value}"><title>release: ${value}</title><filter id="blur"><feGaussianBlur stdDeviation="16"/></filter><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${labelW}" height="20" fill="#555"/><rect x="${labelW}" width="${valueW}" height="20" fill="#007ec6"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">${text(255, 390, "release")}${text(valueX, valueText, value)}</g></svg>\n`;
writeFileSync(join(root, "docs/img/badge-release.svg"), svg);
console.log(`docs/img/badge-release.svg: release ${value}`);
