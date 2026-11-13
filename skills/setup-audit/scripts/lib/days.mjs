// The time window of a scan: `--days N` (default 14 in every script) and the local calendar day of a timestamp.
// Day keys are local dates, so two scripts that print the same day agree on which day it is.
import { opt } from "./opt.mjs";

export const DEFAULT_DAYS = 14;
export const DAY_MS = 86400000;

export function daysWindow(argv) {
  const days = Number(opt("days", DEFAULT_DAYS, argv));
  return { days, since: Date.now() - days * DAY_MS };
}

export const pad = (n) => String(n).padStart(2, "0");
export const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
