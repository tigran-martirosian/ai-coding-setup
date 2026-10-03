#!/usr/bin/env node
// Court of models: runs the outside seats (GPT through Codex, Gemini through agy).
//   node court.mjs open <run folder>    answers from every default gpt/gemini seat in roles.md
//   node court.mjs review <run folder>  blind peer review of every answer in the folder
//   node court.mjs bundle <run folder>  the quick court: the same bundle and key, without the reviews
// The run folder must already hold question.txt. Claude seats are run by the session (Agent tool).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Every seat runs on a strong model: a weak seat drags the court down more than an extra voice lifts it.
const TIMEOUT_MS = Number(process.env.COURT_TIMEOUT_MS || 420000);
const AGY_MODEL = process.env.COURT_AGY_MODEL || 'gemini-3.8-flash-high';
const GPT_EFFORT = process.env.COURT_GPT_EFFORT || 'high';
const FAILED = 'SEAT FAILED';

const ANSWER_RULES = `Answer the question below on your own. Lead with your answer, then the reasoning.
At most 220 words, plain language. End with two lines: "Confidence: high|medium|low" and
"Would change my mind: <one thing>". Do not ask questions back and do not write any files.`;

const REVIEW_RULES = `Below are anonymous answers to one question. You are a strict reviewer.
1. For each answer: its factual errors, weak reasoning and gaps (at most 2 lines each; say "sound" if none).
2. Rank the answers from best to worst, one line of why each.
3. List the points where the answers really disagree, and which side the evidence supports.
At most 320 words. Do not write any files.`;

// roles.md: "## <id>" sections with "runs on:" and "default:" lines, the rest is the seat's brief.
export function loadRoles(text) {
  return text.split(/^## /m).slice(1).map((block) => {
    const lines = block.split(/\r?\n/);
    const id = lines[0].trim();
    const field = (name) => {
      const m = block.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
      return m ? m[1].trim().toLowerCase() : '';
    };
    const brief = lines.slice(1).filter((l) => !/^(runs on|default|model):/i.test(l)).join('\n').trim();
    return { id, runsOn: field('runs on'), isDefault: field('default') === 'yes', brief };
  });
}

function run(cmd, args, { input, shell = false } = {}) {
  return new Promise((done) => {
    let out = '', err = '', settled = false;
    const finish = (ok, text) => { if (!settled) { settled = true; clearTimeout(timer); done({ ok, text }); } };
    const child = spawn(cmd, args, { shell, windowsHide: true });
    const timer = setTimeout(() => { child.kill(); finish(false, `timed out after ${TIMEOUT_MS / 1000}s`); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(false, e.message));
    child.on('close', (code) => finish(code === 0, code === 0 ? out : (err || out).slice(-600)));
    if (input === undefined) child.stdin.end(); else child.stdin.end(input);
  });
}

// Codex takes the prompt on stdin ("-") and writes its last message to a file, so no quoting is needed.
async function askGpt(prompt, outFile) {
  const tmp = `${outFile}.tmp`;
  const cmd = `codex --search exec --skip-git-repo-check -s read-only -c windows.sandbox=unelevated`
    + ` -c model_reasoning_effort=${GPT_EFFORT} -o "${tmp}" -`;
  const r = await run(cmd, [], { input: prompt, shell: true });
  if (r.ok && existsSync(tmp)) {
    const text = readFileSync(tmp, 'utf8').trim();
    rmSync(tmp);
    return { ok: text.length > 0, text: text || 'empty answer' };
  }
  if (existsSync(tmp)) rmSync(tmp);
  return { ok: false, text: r.text };
}

// agy ignores stdin, so the prompt is one argument (no shell, so no quoting either).
async function askGemini(prompt) {
  const r = await run('agy', ['-p', prompt, '--mode', 'plan', '--model', AGY_MODEL]);
  const text = r.text.trim();
  return { ok: r.ok && text.length > 0, text: text || 'empty answer' };
}

// A seat or a reviewer runs only when its command-line tool is on the PATH.
const onPath = (name) => (process.env.PATH || '').split(delimiter)
  .some((d) => d && ['', '.cmd', '.exe', '.ps1'].some((e) => existsSync(join(d, name + e))));
const ASK = {};
if (onPath('codex')) ASK.gpt = askGpt;
if (onPath('agy')) ASK.gemini = askGemini;
const words = (s) => s.split(/\s+/).filter(Boolean).length;

function answerFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('review-') && !['verdict.md', 'bundle.md'].includes(f));
}

async function open(dir) {
  const question = readFileSync(join(dir, 'question.txt'), 'utf8').trim();
  const seats = loadRoles(readFileSync(join(HERE, 'roles.md'), 'utf8')).filter((r) => r.isDefault && ASK[r.runsOn]);
  if (!seats.length) console.log('Neither codex nor agy is on the PATH: the Claude seats sit alone.');
  await Promise.all(seats.map(async (seat) => {
    const file = join(dir, `${seat.id}.md`);
    const r = await ASK[seat.runsOn](`${seat.brief}\n\n${ANSWER_RULES}\n\nQUESTION:\n${question}`, file);
    writeFileSync(file, r.ok ? r.text + '\n' : `${FAILED}: ${r.text}\n`);
    console.log(`${seat.id} (${seat.runsOn}): ${r.ok ? `ok, ${words(r.text)} words` : `FAILED: ${r.text.slice(0, 200)}`}`);
  }));
}

async function review(dir, withReviews = true) {
  const question = readFileSync(join(dir, 'question.txt'), 'utf8').trim();
  const all = answerFiles(dir).map((f) => ({ seat: f.slice(0, -3), text: readFileSync(join(dir, f), 'utf8').trim() }));
  const failed = all.filter((a) => a.text.startsWith(FAILED) || !a.text);
  const good = all.filter((a) => !failed.includes(a));
  if (good.length < 2) { console.log(`Only ${good.length} answer(s) in ${dir}; a court needs at least 2.`); process.exit(1); }
  for (let i = good.length - 1; i > 0; i--) {           // shuffle, so a label says nothing about the seat
    const j = Math.floor(Math.random() * (i + 1));
    [good[i], good[j]] = [good[j], good[i]];
  }
  good.forEach((a, i) => { a.label = String.fromCharCode(65 + i); });
  const bundle = good.map((a) => `--- ANSWER ${a.label} ---\n${a.text}`).join('\n\n');
  const prompt = `${REVIEW_RULES}\n\nQUESTION:\n${question}\n\n${bundle}`;
  const reviews = await Promise.all(Object.entries(withReviews ? ASK : {}).map(async ([who, ask]) => {
    const file = join(dir, `review-${who}.md`);
    const r = await ask(prompt, file);
    writeFileSync(file, r.ok ? r.text + '\n' : `${FAILED}: ${r.text}\n`);
    return { who, ...r };
  }));
  writeFileSync(join(dir, 'key.json'), JSON.stringify(Object.fromEntries(good.map((a) => [a.label, a.seat])), null, 2));
  // bundle.md is what the chair reads. It has no names in it, so the chair can't favour a model.
  const reviewText = reviews.map((r, i) => `=== REVIEWER ${i + 1} ===\n${r.ok ? r.text : 'This reviewer failed.'}`).join('\n\n');
  writeFileSync(join(dir, 'bundle.md'), `QUESTION:\n${question}\n\n${bundle}\n${withReviews ? `\n${reviewText}\n` : ''}`);
  console.log(`bundle.md written: ${good.length} answers, ${withReviews ? `${reviews.filter((r) => r.ok).length} of ${reviews.length} reviews` : 'no reviews (quick court)'}`);
  console.log(`KEY (hidden from the reviewers and the chair): ${good.map((a) => `${a.label}=${a.seat}`).join(', ')}`);
  if (failed.length) console.log(`SEATS THAT FAILED: ${failed.map((a) => a.seat).join(', ')}`);
  for (const r of reviews) if (!r.ok) console.log(`REVIEW BY ${r.who.toUpperCase()} FAILED: ${r.text.slice(0, 300)}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, dirArg] = process.argv.slice(2);
  const dir = dirArg ? resolve(dirArg) : '';
  if (!['open', 'review', 'bundle'].includes(mode) || !dir || !existsSync(join(dir, 'question.txt'))) {
    console.log('Usage: node court.mjs open|review|bundle <run folder that holds question.txt>');
    process.exit(1);
  }
  const reviewers = Object.keys(ASK).length;
  if (mode === 'review' && !reviewers) console.log('Neither codex nor agy is on the PATH: the bundle is written without reviews.');
  await (mode === 'open' ? open(dir) : review(dir, mode === 'review' && reviewers > 0));
}
