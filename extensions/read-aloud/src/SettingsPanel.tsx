import { useCallback, useEffect, useState } from 'react';
import { callBackend } from './bridge';
import { player, usePlayer } from './player';
import { DEFAULTS, updateSetting, useSettings, VOICES, type ReadAloudSettings } from './settings';
import { setAutoRead } from './autoRead';

interface WorkerStatus {
  worker: 'stopped' | 'starting' | 'ready' | 'error';
  pid: number | null;
  loadMs: number | null;
  uptimeSec: number;
  requestsServed: number;
  lastError: string | null;
  missing: string[];
  dir: string;
}

const SAMPLE = 'Read Aloud is working. This voice runs entirely on your computer.';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' };
const label: React.CSSProperties = { width: 170, fontSize: 13, color: 'var(--nim-text)' };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--nim-text-muted)' };
const btn: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid var(--nim-border)',
  background: 'var(--nim-bg-secondary)',
  color: 'var(--nim-text)',
  cursor: 'pointer',
  fontSize: 13,
};
const input: React.CSSProperties = { ...btn, cursor: 'text', flex: 1, maxWidth: 360 };

export function ReadAloudSettingsPanel() {
  const s = useSettings();
  const st = usePlayer();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirDraft, setDirDraft] = useState(s.ttsDirectory);

  useEffect(() => setDirDraft(s.ttsDirectory), [s.ttsDirectory]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await callBackend<WorkerStatus>('status', { dir: s.ttsDirectory }));
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, [s.ttsDirectory]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const set = <K extends keyof ReadAloudSettings>(k: K, v: ReadAloudSettings[K]) => void updateSetting(k, v);

  const act = async (tool: 'warmup' | 'shutdown_worker') => {
    setBusy(true);
    try {
      await callBackend(tool, { dir: s.ttsDirectory });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
    void refresh();
  };

  const testing = st.key === 'settings-test';
  const testError = st.error?.key === 'settings-test' ? st.error.message : null;

  return (
    <div style={{ padding: '4px 0', maxWidth: 640 }}>
      <p style={hint}>
        Reads agent replies aloud with Kokoro running on this computer. Nothing is sent over the network and there are no
        per-use costs.
      </p>

      <div style={row}>
        <span style={label}>Enable Read Aloud</span>
        <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
      </div>

      <div style={row}>
        <span style={label}>Hands-free (auto-read)</span>
        <input
          type="checkbox"
          checked={s.autoRead}
          onChange={(e) => {
            set('autoRead', e.target.checked);
            setAutoRead(e.target.checked);
          }}
        />
        <span style={hint}>Reads each finished reply and each question aloud. Also: /voice in chat.</span>
      </div>

      <div style={row}>
        <span style={label}>Voice</span>
        <select style={btn} value={s.voice} onChange={(e) => set('voice', e.target.value)}>
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v === DEFAULTS.voice ? `${v} (default)` : v}
            </option>
          ))}
        </select>
        <span style={hint}>American English</span>
      </div>

      <div style={row}>
        <span style={label}>Speed</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={s.speed}
          onChange={(e) => set('speed', Number(e.target.value))}
          style={{ flex: 1, maxWidth: 260 }}
        />
        <span style={{ ...hint, width: 40 }}>{s.speed.toFixed(2)}x</span>
        {s.speed !== DEFAULTS.speed && (
          <button style={btn} onClick={() => set('speed', DEFAULTS.speed)}>
            Reset
          </button>
        )}
      </div>

      <div style={row}>
        <span style={label}>Skip code blocks</span>
        <input type="checkbox" checked={s.skipCodeBlocks} onChange={(e) => set('skipCodeBlocks', e.target.checked)} />
      </div>

      <div style={row}>
        <span style={label}>Skip terminal output and diffs</span>
        <input type="checkbox" checked={s.skipTerminalOutput} onChange={(e) => set('skipTerminalOutput', e.target.checked)} />
      </div>

      <div style={row}>
        <span style={label}>Local TTS folder</span>
        <input style={input} value={dirDraft} onChange={(e) => setDirDraft(e.target.value)} />
        {dirDraft !== s.ttsDirectory && (
          <button style={btn} onClick={() => set('ttsDirectory', dirDraft.trim() || DEFAULTS.ttsDirectory)}>
            Save
          </button>
        )}
      </div>
      <p style={hint}>Expects venv\Scripts\python.exe, kokoro-v1.0.onnx and voices-v1.0.bin inside this folder.</p>

      <div style={{ ...row, marginTop: 18 }}>
        <button style={btn} disabled={!s.enabled} onClick={() => (testing ? player.stop() : player.play('settings-test', SAMPLE))}>
          {testing ? 'Stop test' : 'Test voice'}
        </button>
        <button style={btn} disabled={busy} onClick={() => act('warmup')}>
          Start worker
        </button>
        <button style={btn} disabled={busy} onClick={() => act('shutdown_worker')}>
          Stop worker
        </button>
      </div>
      {testError && <p style={{ ...hint, color: 'var(--nim-error)' }}>{testError}</p>}

      <div style={{ ...hint, marginTop: 8, lineHeight: 1.6 }}>
        {statusError && <div style={{ color: 'var(--nim-error)' }}>{statusError}</div>}
        {status && (
          <>
            <div>
              Worker: <b>{status.worker}</b>
              {status.pid ? ` (pid ${status.pid}, up ${status.uptimeSec}s, ${status.requestsServed} requests)` : ''}
              {status.loadMs != null ? `, model loaded in ${status.loadMs} ms` : ''}
            </div>
            {status.missing.map((m) => (
              <div key={m} style={{ color: 'var(--nim-error)' }}>
                Missing {m}
              </div>
            ))}
            {status.lastError && <div style={{ color: 'var(--nim-error)' }}>{status.lastError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
