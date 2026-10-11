// Loaded before inbox-bot.mjs by test-inbox-bot.mjs: replaces fetch so no test touches Telegram.
//   STUB_FAILS   how many calls fail with "fetch failed" first (the network is not up yet)
//   STUB_GETME   "401" makes getMe answer Unauthorized
//   STUB_HANG    "1" makes getUpdates never answer (the bot stays up); otherwise the bot is ended there
//   STUB_UPDATES      a JSON file with an array of updates, served once by the first getUpdates
//   STUB_END_AFTER_MS how long the next getUpdates waits before ending the process (so timers can fire)
//   STUB_SENT         a file that gets every sendMessage body as one JSON line
//   STUB_CALLS        a file that gets every sendChatAction, answerCallbackQuery, editMessageReplyMarkup and
//                     sendDocument call (a document as { caption, name, chars }) as one JSON line
// getFile answers file_path "files/<file_id>"; downloads return a few fake bytes.
import fs from 'node:fs';

let calls = 0;
let served = false;
let sentCount = 0;
const fails = Number(process.env.STUB_FAILS || 0);

function answer(body) {
  return { json: async () => body };
}

globalThis.fetch = async (url, init) => {
  calls += 1;
  if (calls <= fails) throw new TypeError('fetch failed');
  if (String(url).includes('/file/bot')) {
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('fake bytes') };
  }
  const method = String(url).split('/').pop();
  if (method === 'getMe') {
    if (process.env.STUB_GETME === '401') return answer({ ok: false, error_code: 401, description: 'Unauthorized' });
    return answer({ ok: true, result: { username: 'testbot' } });
  }
  if (method === 'getUpdates') {
    if (process.env.STUB_HANG === '1') return new Promise(() => setInterval(() => {}, 1000));
    if (process.env.STUB_UPDATES && !served) {
      served = true;
      return answer({ ok: true, result: JSON.parse(fs.readFileSync(process.env.STUB_UPDATES, 'utf8')) });
    }
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.STUB_END_AFTER_MS || 0)));
    process.exit(0);
  }
  if (method === 'getFile') {
    return answer({ ok: true, result: { file_path: `files/${JSON.parse(init.body).file_id}` } });
  }
  if (method === 'sendMessage') {
    if (process.env.STUB_SENT) fs.appendFileSync(process.env.STUB_SENT, init.body + '\n');
    sentCount += 1; // the first sent message is 101, the next 102, ...
    return answer({ ok: true, result: { message_id: 100 + sentCount } });
  }
  if (['sendChatAction', 'answerCallbackQuery', 'editMessageReplyMarkup', 'editMessageText', 'sendDocument'].includes(method)) {
    let entry;
    if (method === 'sendDocument') {
      const doc = init.body.get('document');
      entry = { method, caption: init.body.get('caption'), chat_id: init.body.get('chat_id'), name: doc.name, chars: (await doc.text()).length };
    } else {
      entry = { method, ...JSON.parse(init.body) };
    }
    if (process.env.STUB_CALLS) fs.appendFileSync(process.env.STUB_CALLS, JSON.stringify(entry) + '\n');
    return answer({ ok: true, result: true });
  }
  throw new Error(`the stub has no answer for ${method}`);
};
