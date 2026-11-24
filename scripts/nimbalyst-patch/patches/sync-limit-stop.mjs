// Our own change, not an upstream PR: a session that reached the sync server's size cap stops sending, as one at
// the message-count cap already does. Nimbalyst treated storage_limit_exceeded ("Session would exceed hard limit
// of 26214400 bytes") like one oversized message and skipped it, so every later message of that session went to
// the server, was refused and logged twice (3,742 refusals in three hours from one long session, 2026-11-23).
// The cap is for the whole session and only grows, so no later message can fit. The session keeps working on
// this computer; only its sync to other devices stops, until the next app start tries once more.
// Retires when Nimbalyst's own list of fatal codes carries it.
export default {
  id: "sync-limit-stop",
  files: /^out\/main\/.+\.js$/,
  upstream: `const FATAL_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_limit_exceeded",
  "storage_limit_exceeded"
]);`,
  edits: [
    {
      anchor: `const FATAL_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_limit_exceeded"
]);
const SKIPPABLE_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_too_large",
  "storage_limit_exceeded"
]);`,
      replace: `const FATAL_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_limit_exceeded",
  // sync-limit-stop patch: the session's size cap only grows, so its sync stops instead of retrying each message
  "storage_limit_exceeded"
]);
const SKIPPABLE_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_too_large"
]);`,
    },
  ],
};
