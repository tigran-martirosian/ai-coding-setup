// The rule for a clear commit subject, shared by the commit hook (job-done), the PR-title check in CI and the release
// script. checkSubject(subject, { ids, sessionId }) returns nothing when the subject is clear, else a one-line reason.
//   Length: over MAX_SUBJECT (72) characters is refused.
//   ids: [{ id, plan }], the open job-list rows the caller found (id as the plan writes it, plan file name). A subject
//   word equal to an id (whole word, case-sensitive) is refused; an id counts only with letters before its digits
//   ("V2", "BH1"), so a bare "2" never counts, and "v2" or "MP4" stay free beside an open row "V2" or "P4".
//   sessionId: "session <8 hex>" and the session's own first 8 id characters are refused.
// With no ids and no sessionId only the length is checked (CI and the release script).
export const MAX_SUBJECT = 72;
const ID = /^[A-Za-z]+\d+[a-z]?$/;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (w, flags = "") =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(w)}(?![A-Za-z0-9])`, flags);

export function checkSubject(subject, { ids = [], sessionId } = {}) {
  const s = String(subject);
  if (s.length > MAX_SUBJECT)
    return `the subject is ${s.length} characters; keep it to ${MAX_SUBJECT} or fewer`;
  for (const { id, plan } of ids) {
    if (ID.test(id) && word(id).test(s))
      return `"${id}" is the id of an open row of ${plan} (row ${id}); say what the change gives instead`;
  }
  if (sessionId === undefined) return;
  if (/(?<![A-Za-z0-9])session\s+[0-9a-f]{8}(?![A-Za-z0-9])/i.test(s))
    return "the subject names a session id; say what the change gives instead";
  const own = String(sessionId).slice(0, 8);
  if (/^[\w-]{8}$/.test(own) && word(own, "i").test(s))
    return `the subject holds this session's id (${own}); say what the change gives instead`;
}
