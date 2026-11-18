// The rule for which PC actions a screen may use; frame/app.js greys a screen whose actions are not all offered.

// Whether the PC that gave `hello` answers `action`. A PC that did not verify this page answers pc.status alone. A PC
// that names its actions in the hello offers those; one that names none is 26.3.3 or older and has no Files actions
// (`folder.*` came with the list), so the frame greys the Files tab with its update line.
export function offers(hello, action) {
  if (action === "pc.status") return true;
  if (hello.page !== "ok") return false;
  if (Array.isArray(hello.actions)) return hello.actions.includes(action);
  return !action.startsWith("folder.");
}
