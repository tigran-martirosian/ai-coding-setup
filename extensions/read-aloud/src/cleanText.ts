/**
 * Turns an assistant message's Markdown into speakable prose, and splits it
 * into chunks for incremental synthesis. The visible transcript is untouched.
 */

export interface CleanOptions {
  skipCodeBlocks: boolean;
  skipTerminalOutput: boolean;
}

const DIFF_LANGS = new Set(['diff', 'patch', 'udiff']);
const OUTPUT_LANGS = new Set(['', 'text', 'txt', 'plaintext', 'console', 'output', 'log', 'shell-session', 'terminal']);
const COMMAND_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'fish']);
const MAX_CODE_LINES_READ = 12;
const MAX_TABLE_ROWS_READ = 8;

/** Hidden spoken summary the agent adds in voice mode: `<!-- voice: ... -->`. */
export const VOICE_MARKER = /<!--\s*voice:\s*([\s\S]*?)\s*-->/gi;

/** Splits a reply into the visible body and its hidden spoken summary (the last one wins). */
export function splitVoice(markdown: string): { body: string; summary: string | null } {
  let summary: string | null = null;
  const body = markdown
    .replace(VOICE_MARKER, (_, s: string) => {
      if (s.trim()) summary = s.trim();
      return '';
    })
    .trim();
  return { body, summary };
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function looksLikePath(s: string): boolean {
  return /^([A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)/.test(s) || (/[\\/]/.test(s) && /\.\w{1,6}$/.test(s) && !/\s/.test(s));
}

function urlHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'a link';
  }
}

/** Plain-text label for a link target when the label itself is a URL or path. */
function friendly(s: string): string {
  const t = s.trim();
  if (/^https?:\/\//i.test(t)) return urlHost(t);
  if (looksLikePath(t)) return basename(t.replace(/:\d+(:\d+)?$/, ''));
  return t;
}

function inline(text: string): string {
  let s = text;
  // Raw HTML tags and a few entities.
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  // Images, links, autolinks.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? alt : ''));
  s = s.replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/g, (_, label) => friendly(label));
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  s = s.replace(/<(https?:\/\/[^>]+)>/g, (_, u) => urlHost(u));
  s = s.replace(/\bhttps?:\/\/[^\s)\]]+/g, (u) => urlHost(u));
  // Inline code: keep short useful bits, shorten paths, drop long snippets.
  s = s.replace(/`([^`]+)`/g, (_, code: string) => {
    const c = code.trim();
    if (looksLikePath(c)) return basename(c.replace(/:\d+(:\d+)?$/, ''));
    if (c.length <= 40) return c;
    return '';
  });
  // Bare file paths.
  s = s.replace(/(?<![\w/])[A-Za-z]:\\[^\s,;)]+/g, (p) => basename(p));
  s = s.replace(/(?<![\w.:])(?:\/[\w.@-]+){3,}\/?/g, (p) => basename(p));
  // Emphasis and strikethrough markers.
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2');
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2');
  s = s.replace(/~~(.+?)~~/g, '$1');
  // Symbols that read badly.
  s = s.replace(/\s*(→|->|=>)\s*/g, ' to ').replace(/\s*←\s*/g, ' from ');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!$|>~])/g, '$1');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

function endSentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?:;…]["')\]]*$/.test(t) ? t : `${t}.`;
}

function codeBlockSpeech(lang: string, body: string, opts: CleanOptions): string {
  const l = lang.toLowerCase();
  const isDiff = DIFF_LANGS.has(l) || /^(@@|\+\+\+|---) /m.test(body);
  const isOutput = OUTPUT_LANGS.has(l) && !isDiff;
  if (isDiff) return opts.skipTerminalOutput || opts.skipCodeBlocks ? 'Diff omitted.' : readCode(body);
  if (isOutput) return opts.skipTerminalOutput ? 'Output omitted.' : readCode(body);
  if (opts.skipCodeBlocks) return COMMAND_LANGS.has(l) ? 'Command omitted.' : 'Code omitted.';
  return readCode(body);
}

function readCode(body: string): string {
  const lines = body.split('\n').filter((l) => l.trim());
  const head = lines.slice(0, MAX_CODE_LINES_READ).map((l) => endSentence(inline(l)));
  const more = lines.length > MAX_CODE_LINES_READ ? ` And ${lines.length - MAX_CODE_LINES_READ} more lines.` : '';
  return head.join(' ') + more;
}

function tableSpeech(rows: string[]): string {
  const cells = rows
    .filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r))
    .map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => inline(c)).filter(Boolean));
  const read = cells.slice(0, MAX_TABLE_ROWS_READ + 1).map((c) => endSentence(c.join(', ')));
  const extra = cells.length - read.length;
  return read.join('\n') + (extra > 0 ? `\nAnd ${extra} more rows.` : '');
}

const STACK_LINE = /^\s*(at\s+\S+.*\(.*:\d+(:\d+)?\)|at\s+[\w.<>$]+\s*\(?[\w/\\.:-]+:\d+|File ".*", line \d+|Traceback \(most recent call last\):)/;

/**
 * Markdown in, speakable prose out. Paragraphs are separated by blank lines
 * (a long pause when spoken); the items of one list sit on consecutive lines
 * (a sentence pause).
 */
export function cleanForSpeech(markdown: string, opts: CleanOptions): string {
  const src = markdown.replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let lastWasItem = false;
  const emit = (s: string, item = false) => {
    if (!s) return;
    if (item && lastWasItem) out[out.length - 1] += '\n' + s;
    else out.push(s);
    lastWasItem = item;
  };
  const flush = () => {
    if (para.length) emit(endSentence(para.join(' ')));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
      emit(codeBlockSpeech(fence[2] ?? '', body.join('\n'), opts));
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      emit(tableSpeech(rows));
      continue;
    }

    if (STACK_LINE.test(line)) {
      flush();
      while (i + 1 < lines.length && (STACK_LINE.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) i++;
      if (out[out.length - 1] !== 'Stack trace omitted.') emit('Stack trace omitted.');
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*(\$|PS [A-Z]:\\[^>]*>|>>>)\s/.test(line)) continue; // pasted prompt lines

    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      emit(endSentence(inline(heading[1])));
      continue;
    }

    const quoteStripped = line.replace(/^\s*(>\s?)+/, '');
    const bullet = /^\s*[-*+]\s+(\[[ xX]\]\s+)?(.*)$/.exec(quoteStripped);
    if (bullet) {
      flush();
      emit(endSentence(inline(bullet[2])), true);
      continue;
    }
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(quoteStripped);
    if (numbered) {
      flush();
      // A comma, not a full stop: "1." would be spoken as a sentence of its own.
      emit(endSentence(`${numbered[1]}, ${inline(numbered[2])}`), true);
      continue;
    }

    const text = inline(quoteStripped);
    if (text) para.push(text);
  }
  flush();

  return out
    .filter((s) => s.replace(/[.\s]/g, ''))
    .join('\n\n')
    .replace(/\.{2,}(?!\.)/g, '.')
    .trim();
}

export interface SpeechChunk {
  /** One sentence per line; a blank line separates paragraphs. The worker pauses at both. */
  text: string;
  /** A paragraph ends with this chunk, so the longer pause follows it. */
  paragraphEnd: boolean;
}

/** Split at sentence boundaries into chunks; the first chunk is short so audio starts fast. */
export function chunkForSpeech(text: string, firstMax = 100, restMax = 360): SpeechChunk[] {
  const sentences: Array<{ text: string; newPara: boolean }> = [];
  for (const para of text.split(/\n{2,}/)) {
    let first = true;
    for (const line of para.split('\n')) {
      const parts = line.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+(?=["'(\[]?[A-Z0-9])/);
      for (const p of parts) {
        if (!p.trim()) continue;
        sentences.push({ text: p.trim(), newPara: first });
        first = false;
      }
    }
  }

  const chunks: SpeechChunk[] = [];
  let cur = '';
  const max = () => (chunks.length === 0 ? firstMax : restMax);
  const push = (paragraphEnd: boolean) => {
    if (cur.trim()) chunks.push({ text: cur.trim(), paragraphEnd });
    cur = '';
  };

  for (const s of sentences) {
    splitLong(s.text, restMax).forEach((piece, n) => {
      const newPara = s.newPara && n === 0;
      // Pieces of one over-long sentence stay on one line, so no pause falls between them.
      const sep = newPara ? '\n\n' : n === 0 ? '\n' : ' ';
      if (!cur) cur = piece;
      else if (cur.length + sep.length + piece.length <= max()) cur += sep + piece;
      else {
        push(newPara);
        cur = piece;
      }
    });
  }
  push(false);
  return chunks;
}

/** Break an over-long sentence at clause punctuation, then at word boundaries. */
function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let cur = '';
  for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
    const words = clause.length > max ? clause.split(' ') : [clause];
    for (const w of words) {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
      else {
        out.push(cur);
        cur = w;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}
