// Stand-in for assistant.mjs in test-inbox-bot.mjs (INBOX_ASSISTANT_MODULE).
// The message text picks the answer:
//   "act:<json>"  answers with that action (the reply is "ok")
//   "acts:<json array>" answers with those actions (the reply is "ok")
//   "fail..."     throws
//   anything else answers "echo: <text>" with action none
// Every ask() is appended to STUB_ASSISTANT_LOG as { text, sessionId }.
import fs from 'node:fs';

export const PROMPT_VERSION = 'stub-v1';

export async function gatherContext() {
  return {
    text: 'stub context',
    refs: {
      projects: { Alpha: 'C:\\alpha', Beta: 'C:\\beta' },
      S1: { projectPath: 'C:\\alpha', projectName: 'Alpha', sessionId: 'sid-1', title: 'Fix login' },
      S2: { projectPath: 'C:\\beta', projectName: 'Beta', sessionId: 'sid-2', title: 'Write docs' },
    },
  };
}

export async function ask({ text, context, sessionId }) {
  if (process.env.STUB_ASSISTANT_LOG) fs.appendFileSync(process.env.STUB_ASSISTANT_LOG, JSON.stringify({ text, context, sessionId }) + '\n');
  if (text.startsWith('fail')) throw new Error('the model is not reachable');
  if (text.includes('acts:')) return { reply: 'ok', actions: JSON.parse(text.slice(text.indexOf('acts:') + 5)), sessionId: 'conv-1', tokens: 7 };
  if (text.startsWith('act:')) return { reply: 'ok', action: JSON.parse(text.slice(4)), sessionId: 'conv-1', tokens: 7 };
  return { reply: `echo: ${text}`, action: { type: 'none' }, sessionId: 'conv-1', tokens: 7 };
}
