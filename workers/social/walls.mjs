// walls.mjs: names a page or error that stops a Reddit or X read: a captcha, a rate-limit or block page, or a
// sign-in wall. social.mjs and reddit.mjs check it only once a read has failed, so a thread that talks about
// captchas never trips it. Pushing on past one is what gets the user's account locked, so the readers print
// FAILED and stop instead of retrying.
export function wall(text) {
  const t = String(text || "");
  if (
    /captcha|verify (that )?you('| a)re (a )?human|prove your humanity|are you a robot|unusual traffic|wait for verification/i.test(
      t,
    )
  )
    return "a captcha";
  // OpenCLI turns Reddit's 401/403 into "not accessible (HTTP 403)"; Reddit's block pages say "whoa there, pardner"
  if (
    /rate.?limit|too many requests|\b429\b|try again later|whoa there,? pardner|blocked by network security|not accessible \(HTTP 40[13]\)/i.test(
      t,
    )
  )
    return "a rate limit or block page";
  if (
    /AUTH_REQUIRED|log ?in to|sign ?in to (continue|see|view)|re-?login required|auth failed/i.test(
      t,
    )
  )
    return "a sign-in wall";
  return null;
}

export const wallMessage = (site, what, detail) =>
  `${site} showed ${what}${detail ? ` (${detail})` : ""}. Stop here: do not retry or search on; tell the user.`;
