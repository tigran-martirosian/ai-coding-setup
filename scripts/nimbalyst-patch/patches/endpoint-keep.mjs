// Our own change, not an upstream PR: a second Nimbalyst.exe launched while Nimbalyst runs (a click on its icon,
// the phone app's Start Nimbalyst) loses the single-instance lock, waits up to 5 s and quits. Its quit code
// deletes mcp-endpoint.json even though the running app wrote it, so the nim CLI and the phone app see Nimbalyst
// as closed until the next restart. The file holds the writer's pid: this deletes it only when this process
// wrote it (or the file can't be read, as before). Never retires: no upstream fix to wait for yet.
export default {
  id: "endpoint-keep",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `function removeMcpEndpointDescriptor() {
  try {
    fs__namespace.rmSync(descriptorPath(), { force: true });`,
      replace: `function removeMcpEndpointDescriptor() {
  try {
    // endpoint-keep patch: a second instance quitting must not delete the running app's file
    let writer = null;
    try {
      writer = JSON.parse(fs__namespace.readFileSync(descriptorPath(), "utf8")).pid;
    } catch {
    }
    if (typeof writer === "number" && writer !== process.pid) return;
    fs__namespace.rmSync(descriptorPath(), { force: true });`,
    },
  ],
};
