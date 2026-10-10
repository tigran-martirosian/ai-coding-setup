// Stand-in for nimbalyst.mjs in test-inbox-bot.mjs (INBOX_NIMBALYST_MODULE).
//   STUB_NIM_LOG         every call is appended there as one JSON line
//   STUB_NIM_STATES      JSON array of states for sessionStatus, one per call (the last one repeats)
//   STUB_NIM_ANSWER_LEN  length of the lastAnswer text (lines of 50 characters); default a short text
//   STUB_NIM_PENDING     JSON of what pendingPrompt returns (the session waits on it); default null (a form)
//   STUB_NIM_FAIL        "send" makes sendPrompt throw, "respond" makes respondToPrompt throw
import fs from 'node:fs';

function note(entry) {
  if (process.env.STUB_NIM_LOG) fs.appendFileSync(process.env.STUB_NIM_LOG, JSON.stringify(entry) + '\n');
}

let polls = 0;

export async function sessionStatus(projectPath, sessionId) {
  note({ fn: 'sessionStatus', sessionId });
  const states = JSON.parse(process.env.STUB_NIM_STATES || '["idle"]');
  const state = states[Math.min(polls++, states.length - 1)];
  return { state, raw: {} };
}

export async function lastAnswer(projectPath, sessionId) {
  note({ fn: 'lastAnswer', sessionId });
  const n = Number(process.env.STUB_NIM_ANSWER_LEN || 0);
  if (!n) return 'The fix is done.';
  const line = 'x'.repeat(49) + '\n';
  return line.repeat(Math.ceil(n / 50)).slice(0, n);
}

export async function waitingQuestion(projectPath, sessionId) {
  note({ fn: 'waitingQuestion', sessionId });
  return 'Allow deleting the build folder?';
}

export async function pendingPrompt(projectPath, sessionId) {
  note({ fn: 'pendingPrompt', sessionId });
  return process.env.STUB_NIM_PENDING ? JSON.parse(process.env.STUB_NIM_PENDING) : null;
}

export async function respondToPrompt(projectPath, sessionId, promptId, promptType, response) {
  note({ fn: 'respondToPrompt', projectPath, sessionId, promptId, promptType, response });
  if (process.env.STUB_NIM_FAIL === 'respond') throw new Error('Nimbalyst is not running');
}

export async function sendPrompt(projectPath, sessionId, text) {
  note({ fn: 'sendPrompt', projectPath, sessionId, text });
  if (process.env.STUB_NIM_FAIL === 'send') throw new Error('Nimbalyst is not running');
}

export async function startSession(projectPath, text) {
  note({ fn: 'startSession', projectPath, text });
  return { id: 'new-sid' };
}
