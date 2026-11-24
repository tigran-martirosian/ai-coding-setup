// Nimbalyst PR #1792 (nimbalyst/nimbalyst): tool approval prompts show the agent's one-line description of
// a Bash command above the raw command, and an `Agent` (sub-agent) call is described like a `Task` call.
// Main side: the permission request carries `description` (three places that build it). Renderer side: the
// ToolPermissionWidget, in a hashed chunk (out/renderer/assets/registerExtensionSystem-*.js), shows it in
// both of its layouts.
// `upstream` is the declaration rollup emits for the PR's `export function getCommandDescription`; this port
// declares the same helper as a const, so a patched bundle never holds the marker.
const TEST_ID = `"data-testid": "tool-permission-description", className: "text-sm text-nim", children: description`;
const DESCRIPTION = `description && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ${TEST_ID} })`;
const COMMAND = `/* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-nim-tertiary rounded p-2 max-h-[200px] overflow-x-auto", children: /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "font-mono text-xs text-nim whitespace-pre-wrap break-all", children: rawCommand || toolName2 }) })`;

export default {
  id: "1792",
  files:
    /^out\/(main\/index|renderer\/assets\/registerExtensionSystem-[\w-]+)\.js$/,
  upstream: "function getCommandDescription(",
  edits: [
    // toolPermissionHelpers.ts buildToolDescription: a sub-agent call reads like a Task call
    {
      anchor: `    case "Task":
      return input?.description || input?.prompt?.slice(0, 50) || "spawn task";
`,
      replace: `    case "Task":
    case "Agent":
      return input?.description || input?.prompt?.slice(0, 50) || "spawn task";
`,
    },
    // toolPermissionHelpers.ts: getCommandDescription (new)
    {
      anchor: `  }
}
function generateToolPattern(toolName2, input) {
`,
      replace: `  }
}
const getCommandDescription = (toolName2, input) => {
  if (toolName2 !== "Bash" || typeof input?.description !== "string") return void 0;
  return input.description.trim() || void 0;
};
function generateToolPattern(toolName2, input) {
`,
    },
    // AgentToolHooks.ts: the permission request carries the description
    {
      anchor: `              toolName: toolName2,
              rawCommand,
`,
      replace: `              toolName: toolName2,
              rawCommand,
              description: getCommandDescription(toolName2, toolInput),
`,
    },
    // toolAuthorization.ts handleToolPermissionWithService
    {
      anchor: `          rawCommand: toolName2 === "Bash" ? input?.command || "" : toolDescription,
`,
      replace: `          rawCommand: toolName2 === "Bash" ? input?.command || "" : toolDescription,
          description: getCommandDescription(toolName2, input),
`,
    },
    // toolAuthorization.ts handleToolPermissionFallback
    {
      anchor: `          toolName: toolName2,
          rawCommand,
          pattern: pattern2,
`,
      replace: `          toolName: toolName2,
          rawCommand,
          description: getCommandDescription(toolName2, input),
          pattern: pattern2,
`,
    },
    // ToolPermissionWidget.tsx: read the description
    {
      anchor: `  const rawCommand = unwrapShellCommand(args.rawCommand || "");
`,
      replace: `  const rawCommand = unwrapShellCommand(args.rawCommand || "");
  const description = args.description || "";
`,
    },
    // ToolPermissionWidget.tsx, first layout: description above the command
    {
      anchor: `jsxRuntimeExports.jsx("div", { className: "p-3", children: ${COMMAND} })`,
      replace: `jsxRuntimeExports.jsxs("div", { className: "p-3 flex flex-col gap-2", children: [
            ${DESCRIPTION},
            ${COMMAND}
          ] })`,
    },
    // ToolPermissionWidget.tsx, second layout: description after the warnings, above the command
    {
      anchor: `          ] }, i2)) }),
          ${COMMAND},
`,
      replace: `          ] }, i2)) }),
          ${DESCRIPTION},
          ${COMMAND},
`,
    },
  ],
};
