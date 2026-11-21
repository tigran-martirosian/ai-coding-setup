// The rule for a clear commit subject, used by the PR-title check in CI (scripts/check-pr-title.mjs).
// checkSubject(subject) returns nothing when the subject is clear, else a one-line reason: over MAX_SUBJECT (72)
// characters is refused.
export const MAX_SUBJECT = 72;

export function checkSubject(subject) {
  const s = String(subject);
  if (s.length > MAX_SUBJECT)
    return `the subject is ${s.length} characters; keep it to ${MAX_SUBJECT} or fewer`;
}
