// Our own change, not an upstream PR: tool and helper cards stay where they first showed when the reply's
// text arrives. The agent transcript (computeTranscriptRowInfos in RichTranscriptView) draws tool calls as their
// own rows while they run; when an assistant text message follows them, it hid those rows and drew the same
// cards again inside the text's bubble, a little further left and down. Every card was unmounted and mounted again
// in a new place at once: the chat jumped, and with several helpers it blanked and lagged for a moment
// (seen 2026-11-14, six helpers started in one message; measured layout shift 0.27 at the regroup).
// With this patch the tool rows stay as they are and the text bubble comes in below them, so messages, helper
// cards and file edits arrive one after another. Finished chats look the same way: the cards sit above the
// bubble instead of inside it. Never retires: no upstream fix to wait for.
export default {
  id: "tool-rows-stay",
  files: /^out\/renderer\/assets\/registerExtensionSystem-[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  edits: [
    // A tool row followed by assistant text stays a row of its own
    {
      anchor: `    if (isTool[i2]) {
      const j2 = nextNonTool[i2];
      if (j2 < n3 && messages[j2].type === "assistant_message") {
        info2.kind = "hidden";
        return;
      }
    }
`,
      replace: `    // tool-rows-stay: a tool row followed by assistant text keeps its own row (no regroup into the bubble)
`,
    },
    // The text bubble no longer draws the tool rows above it a second time
    {
      anchor: `    if (isAssistant && toolRunStart >= 0) {
      const entries2 = [];
      for (let k2 = toolRunStart; k2 < i2; k2++) {
        if (showToolCalls || isInteractiveWidgetTool(messages[k2].toolCall?.toolName)) {
          entries2.push(makeEntry(k2));
        }
      }
      info2.toolEntries = entries2.length > 0 ? entries2 : null;
    }
`,
      replace: `    // tool-rows-stay: the bubble draws no tool cards; they keep their own rows above it
`,
    },
  ],
};
