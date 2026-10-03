/**
 * Read Aloud backend module (Electron utility-process).
 *
 * Owns the persistent Kokoro Python worker. The renderer can only reach the
 * narrow tool methods below (synthesize, stop, status, warmup, shutdown_worker,
 * set_auto_read); there is no generic process execution. The worker binary and
 * script paths are derived from the configured TTS folder, never passed in.
 *
 * Protocol with the worker: newline-delimited JSON over stdin/stdout, one
 * request in flight at a time (see worker/tts_worker.py).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ActivateCtx {
  services: {
    log: (level: LogLevel, message: string, data?: unknown) => void;
    registerMcpTools: (
      tools: Array<{ name: string; description?: string; inputSchema?: unknown; panelOnly?: boolean }>
    ) => Promise<{ registered: string[] }>;
  };
}

const DEFAULT_DIR = 'C:\\LocalTTS';
const START_TIMEOUT_MS = 120_000;
const SYNTH_TIMEOUT_MS = 120_000;
const MAX_TEXT_CHARS = 2_000;
const WORKER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker', 'tts_worker.py');

type WorkerState = 'stopped' | 'starting' | 'ready' | 'error';

interface Job {
  id: number;
  payload: Record<string, unknown>;
  resolve: (v: WorkerReply) => void;
  reject: (e: Error) => void;
}

interface WorkerReply {
  id: number;
  ok: boolean;
  error?: string;
  wav_b64?: string;
  sample_rate?: number;
  duration?: number;
  synth_ms?: number;
}

function requiredPaths(dir: string) {
  return {
    python: path.join(dir, 'venv', 'Scripts', 'python.exe'),
    model: path.join(dir, 'kokoro-v1.0.onnx'),
    voices: path.join(dir, 'voices-v1.0.bin'),
  };
}

function findMissing(dir: string): string[] {
  const p = requiredPaths(dir);
  const missing: string[] = [];
  if (!existsSync(p.python)) missing.push(`Python: ${p.python}`);
  if (!existsSync(p.model)) missing.push(`Kokoro model: ${p.model}`);
  if (!existsSync(p.voices)) missing.push(`Voice pack: ${p.voices}`);
  if (!existsSync(WORKER_SCRIPT)) missing.push(`Worker script: ${WORKER_SCRIPT}`);
  return missing;
}

function cleanDir(dir: unknown): string {
  const d = typeof dir === 'string' && dir.trim() ? dir.trim() : DEFAULT_DIR;
  return path.resolve(d);
}

class KokoroWorker {
  state: WorkerState = 'stopped';
  lastError: string | null = null;
  loadMs: number | null = null;
  pid: number | null = null;
  startedAt: number | null = null;
  requestsServed = 0;
  private dir: string | null = null;
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private queue: Job[] = [];
  private inFlight: Job | null = null;
  private inFlightTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private stderrTail = '';

  constructor(private log: ActivateCtx['services']['log']) {}

  async ensure(dir: string): Promise<void> {
    if (this.child && this.dir !== dir) this.kill('TTS folder changed');
    if (this.state === 'ready' && this.child) return;
    if (this.starting) return this.starting;

    const missing = findMissing(dir);
    if (missing.length) {
      this.state = 'error';
      this.lastError = `Missing: ${missing.join('; ')}`;
      throw new Error(this.lastError);
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const p = requiredPaths(dir);
      this.dir = dir;
      this.state = 'starting';
      this.lastError = null;
      this.stderrTail = '';
      const child = spawn(p.python, ['-u', WORKER_SCRIPT, '--model', p.model, '--voices', p.voices], {
        cwd: dir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      this.child = child;
      this.pid = child.pid ?? null;
      this.startedAt = Date.now();

      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.starting = null;
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        this.lastError = 'Kokoro took too long to load';
        this.kill(this.lastError);
        settle(new Error(this.lastError));
      }, START_TIMEOUT_MS);

      child.stderr?.on('data', (d: Buffer) => {
        this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
      });
      createInterface({ input: child.stdout! }).on('line', (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.event === 'ready') {
          this.state = 'ready';
          this.loadMs = typeof msg.load_ms === 'number' ? msg.load_ms : null;
          this.log('info', `[readaloud] Kokoro ready in ${this.loadMs} ms (pid ${this.pid})`);
          settle();
          this.pump();
        } else if (msg.event === 'fatal') {
          this.lastError = String(msg.error ?? 'Kokoro failed to load');
          settle(new Error(this.lastError));
        } else if (typeof msg.id === 'number') {
          this.onReply(msg as unknown as WorkerReply);
        }
      });
      child.on('error', (err) => {
        this.lastError = `Could not start Python: ${err.message}`;
        settle(new Error(this.lastError));
      });
      child.on('exit', (code, signal) => {
        // kill() clears this.child first, so reaching this branch means the exit was not ours.
        if (this.child === child) {
          const wasReady = this.state === 'ready';
          this.child = null;
          this.pid = null;
          this.state = 'error';
          if (wasReady) {
            this.lastError = `Kokoro worker exited unexpectedly (code ${code}). It will restart on the next request.`;
          } else if (!this.lastError) {
            const tail = this.stderrTail.trim().split('\n').slice(-2).join(' ').slice(0, 300);
            this.lastError = `Kokoro worker exited during startup (code ${code})${tail ? `: ${tail}` : ''}`;
          }
        }
        this.failAll(new Error(this.lastError ?? 'Kokoro worker stopped'));
        settle(new Error(this.lastError ?? 'Kokoro worker stopped'));
        this.log('warn', `[readaloud] worker exited code=${code} signal=${signal}`);
      });
    });
    return this.starting;
  }

  synthesize(payload: Record<string, unknown>): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, payload, resolve, reject });
      this.pump();
    });
  }

  /** Drop queued (not yet started) jobs. The in-flight one finishes and is discarded by the renderer. */
  cancelQueued(): number {
    const dropped = this.queue.splice(0);
    for (const job of dropped) job.reject(new Error('cancelled'));
    return dropped.length;
  }

  private pump() {
    if (this.inFlight || this.state !== 'ready' || !this.child?.stdin) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inFlight = job;
    this.inFlightTimer = setTimeout(() => {
      this.lastError = 'Kokoro stopped responding; restarting on next request';
      this.kill(this.lastError);
    }, SYNTH_TIMEOUT_MS);
    this.child.stdin.write(JSON.stringify({ id: job.id, op: 'synthesize', ...job.payload }) + '\n');
  }

  private onReply(reply: WorkerReply) {
    const job = this.inFlight;
    if (!job || job.id !== reply.id) return;
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer);
    this.inFlight = null;
    this.inFlightTimer = null;
    if (reply.ok) {
      this.requestsServed++;
      job.resolve(reply);
    } else {
      job.reject(new Error(reply.error ?? 'synthesis failed'));
    }
    this.pump();
  }

  private failAll(err: Error) {
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer);
    this.inFlightTimer = null;
    if (this.inFlight) this.inFlight.reject(err);
    this.inFlight = null;
    for (const job of this.queue.splice(0)) job.reject(err);
  }

  kill(reason = 'stopped') {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.pid = null;
    this.state = 'stopped';
    this.failAll(new Error(reason));
    try {
      child.stdin?.end();
    } catch {
      /* already closed */
    }
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
    }, 1500);
    child.once('exit', () => clearTimeout(t));
  }

  status(dir: string) {
    return {
      worker: this.state,
      pid: this.pid,
      loadMs: this.loadMs,
      uptimeSec: this.startedAt && this.pid ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      requestsServed: this.requestsServed,
      lastError: this.lastError,
      missing: findMissing(dir),
      dir,
    };
  }
}

const TOOLS = [
  {
    name: 'synthesize',
    panelOnly: true,
    description: 'Synthesize one chunk of text with local Kokoro TTS. Returns base64 WAV.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        voice: { type: 'string' },
        speed: { type: 'number' },
        dir: { type: 'string' },
        paragraphEnd: { type: 'boolean' },
      },
      required: ['text'],
    },
  },
  { name: 'stop', panelOnly: true, description: 'Cancel queued synthesis requests.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'status',
    panelOnly: true,
    description: 'Worker status and auto-read state.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } } },
  },
  {
    name: 'warmup',
    panelOnly: true,
    description: 'Start the Kokoro worker and load the model.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } } },
  },
  { name: 'shutdown_worker', panelOnly: true, description: 'Stop the Kokoro worker.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'set_auto_read',
    description:
      'Turn hands-free Read Aloud on or off in Nimbalyst. When on, each finished assistant reply and each question card is spoken aloud locally (Kokoro). Omit "enabled" to toggle. Use only when the user asks (e.g. the /voice command).',
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } } },
  },
];

export async function activate(ctx: ActivateCtx) {
  const { log, registerMcpTools } = ctx.services;
  const worker = new KokoroWorker(log);
  // The renderer's saved setting is the source of truth for hands-free mode.
  // This backend only relays the agent's /voice request: the renderer adopts
  // it when it sees a new `seq` from this instance. There is one backend per
  // open project, hence the instance id. `uiAutoRead` is the renderer's last
  // reported state, so a bare toggle flips what the user actually sees.
  const instanceId = randomUUID();
  let uiAutoRead = false;
  let autoRead = { enabled: false, seq: 0, at: 0, instanceId };

  await registerMcpTools(TOOLS);

  return {
    methods: {
      synthesize: async (params: { text?: string; voice?: string; speed?: number; dir?: string; paragraphEnd?: boolean }) => {
        const text = String(params?.text ?? '').trim();
        if (!text) throw new Error('Nothing to read');
        if (text.length > MAX_TEXT_CHARS) throw new Error(`Chunk too long (${text.length} chars)`);
        const voice = /^[a-z]{2}_[a-z]+$/.test(String(params?.voice)) ? String(params.voice) : 'af_sky';
        const speed = Math.min(2, Math.max(0.5, Number(params?.speed) || 1));
        await worker.ensure(cleanDir(params?.dir));
        const reply = await worker.synthesize({ text, voice, speed, lang: 'en-us', para_end: params?.paragraphEnd === true });
        return { audio: reply.wav_b64, voice, speed, sampleRate: reply.sample_rate, duration: reply.duration, synthMs: reply.synth_ms };
      },
      stop: async () => ({ cancelled: worker.cancelQueued() }),
      status: async (params: { dir?: string; uiAutoRead?: boolean }) => {
        if (typeof params?.uiAutoRead === 'boolean') uiAutoRead = params.uiAutoRead;
        return { ...worker.status(cleanDir(params?.dir)), autoRead };
      },
      warmup: async (params: { dir?: string }) => {
        const dir = cleanDir(params?.dir);
        try {
          await worker.ensure(dir);
        } catch {
          /* reported via status */
        }
        return { ...worker.status(dir), autoRead };
      },
      shutdown_worker: async () => {
        worker.kill('stopped by user');
        return { worker: worker.state };
      },
      set_auto_read: async (params: { enabled?: boolean }) => {
        const enabled = typeof params?.enabled === 'boolean' ? params.enabled : !uiAutoRead;
        autoRead = { enabled, seq: autoRead.seq + 1, at: Date.now(), instanceId };
        uiAutoRead = enabled;
        return { autoRead: enabled, message: `Read Aloud replies ${enabled ? 'on' : 'off'}.` };
      },
    },
    deactivate: () => {
      worker.kill('extension shutting down');
    },
  };
}
