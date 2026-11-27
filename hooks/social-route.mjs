#!/usr/bin/env node
// social-route: a PreToolUse hook for WebFetch and WebSearch. Anthropic's fetcher and search refuse reddit.com and
// x.com ("domains are not accessible to our user agent"), so a helper that tried them could report "Reddit was
// blocked" and leave the community side of a question out. Both sites read through
// ~/.claude/workers/social/social.mjs instead. This hook refuses a WebFetch of a Reddit or X page, and a WebSearch
// with allowed_domains on those sites (the API answers that with a 400), with the exact social.mjs command.
// A WebSearch with site:reddit.com / site:x.com in its query passes with a note: such a query runs and returns pages
// about the topic, just no threads. A WebSearch that names Reddit or X in its words is refused: as a note it was
// skipped, and the plain search answered a question about what people say on Reddit with old blog posts.
// Every refusal and note says what to do when social.mjs fails (OpenCLI missing, Chrome signed out): run the plain
// WebSearch without the site, so research is never left with no search at all. Fails open. SOCIAL_ROUTE=off
// disables it.
import os from "node:os";
import { emit, runHook } from "./lib/hook-io.mjs";

const TOOL = `node "${os.homedir().replace(/\\/g, "/")}/.claude/workers/social/social.mjs"`;
const SITE = {
  reddit: /(^|\.)(reddit\.com|redd\.it)$/i,
  x: /(^|\.)(x\.com|twitter\.com)$/i,
};
const RULES =
  "Run it with Bash, one call at a time: its searches and X replies drive the user's open Chrome, which serves one session at a time. Plain fetchers, search.json and a headless Chrome are blocked on both sites, so don't try them.";

const siteOf = (host) =>
  Object.keys(SITE).find((k) => SITE[k].test(host || ""));
const hostOf = (s) => {
  try {
    return new URL(/^https?:/i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return "";
  }
};
// A URL or query from the page or the model goes into the suggested shell command in single quotes (an inner ' as
// '\''), and line breaks become spaces, so $(...), backticks and the like stay plain text if the command is run.
const sq = (s) =>
  `'${String(s)
    .replace(/[\r\n]+/g, " ")
    .replace(/'/g, "'\\''")}'`;
const name = (s) => (s === "x" ? "X" : "Reddit");
const deny = (text) => emit.deny(`social-route: ${text}`);
const note = (text) => emit.context("PreToolUse", `[social-route] ${text}`);

runHook("social-route", (event) => {
  const input = event.tool_input || {};

  if (event.tool_name === "WebFetch") {
    const url = String(input.url || "");
    const site = siteOf(hostOf(url));
    if (site)
      return deny(
        `WebFetch can't open ${name(site)} pages (Anthropic's fetcher is refused there). Read it with:\n  ${TOOL} ${sq(url)} --comments 15\n${RULES}`,
      );
  }

  if (event.tool_name === "WebSearch") {
    // -site:reddit.com leaves Reddit out, so it says nothing about wanting Reddit
    const query = String(input.query || "")
      .replace(/(^|\s)-site:\S+/gi, " ")
      .trim();
    const domains = (input.allowed_domains || []).map(String);
    const limited = domains.map((d) => siteOf(hostOf(d))).find(Boolean);
    const inQuery = siteOf(
      hostOf((query.match(/\bsite:(\S+)/i) || [])[1] || ""),
    );
    const words = query
      .replace(/\bsite:\S+/gi, "")
      .replace(/\breddit\b|\br\/\w+/gi, "")
      .trim()
      .replace(/"/g, "");
    if (limited)
      return deny(
        `WebSearch can't search ${name(limited)} (allowed_domains on it is refused by the API). Search it with:\n  ${TOOL} search ${limited} ${sq(words)} --limit 8\nthen read a thread with ${TOOL} "<link>" --comments 15. ${RULES} If social.mjs fails, run the WebSearch again without allowed_domains and say in your report that ${name(limited)} was not read.`,
      );
    if (inQuery)
      return note(
        `This search runs, but expect no ${name(inQuery)} threads in its results (the search engine leaves the site out). For the threads use ${TOOL} search ${inQuery} ${sq(words)} --limit 8, then ${TOOL} "<link>" --comments 15. ${RULES} If social.mjs fails, say in your report that ${name(inQuery)} was not read.`,
      );
    const named = /\breddit\b|\br\/\w+/i.test(query)
      ? "reddit"
      : /\b(twitter|tweets?)\b|\bon x\b/i.test(query)
        ? "x"
        : "";
    // The way out stays open: without the word Reddit/X the search runs.
    if (named)
      return deny(
        `WebSearch doesn't return ${name(named)} threads; this question wants them. Search ${name(named)} itself:\n  ${TOOL} search ${named} ${sq(words)} --limit 8\nthen read a thread with ${TOOL} "<link>" --comments 15. ${RULES} If social.mjs fails, run the WebSearch again without the word ${name(named)} and say in your report that ${name(named)} was not read.`,
      );
  }
});
