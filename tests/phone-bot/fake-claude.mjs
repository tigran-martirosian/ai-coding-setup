// Fake `claude` for test-assistant.mjs: records its arguments and stdin, then prints a made-up answer.
// FAKE_MODE: ok (default) | iserror | badjson | noreply | exit1
import fs from 'node:fs';
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args, stdin }));
const mode = process.env.FAKE_MODE || 'ok';
if (mode === 'badjson') { process.stdout.write('not json at all'); process.exit(0); }
if (mode === 'exit1') { process.stderr.write('boom'); process.exit(1); }
if (mode === 'iserror') { console.log(JSON.stringify({ is_error: true, result: 'Not logged in' })); process.exit(0); }
const out = { is_error: false, session_id: 'conv-123', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 5 } };
out.structured_output = mode === 'noreply' ? { actions: [{ type: 'none' }] } : { reply: 'ok then', actions: [{ type: 'none' }] };
console.log(JSON.stringify(out));
