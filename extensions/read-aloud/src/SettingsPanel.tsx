import { useCallback, useEffect, useState } from 'react';
import { callBackend } from './bridge';
import { player, usePlayer } from './player';
import { DEFAULTS, updateSetting, useSettings, VOICES, type ReadAloudSettings } from './settings';
import { setAutoRead } from './autoRead';
import { formatSpeed, t } from './strings';
import { TRANSCRIPT_CSS } from './transcript';

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

const STATE_TEXT = {
  stopped: t.stateStopped,
  starting: t.stateStarting,
  ready: t.stateReady,
  error: t.stateError,
} as const;
const STATE_DOT = { stopped: '', starting: '', ready: ' live', error: ' error' } as const;

export function ReadAloudSettingsPanel() {
  const s = useSettings();
  const st = usePlayer();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirDraft, setDirDraft] = useState(s.ttsDirectory);
  const [details, setDetails] = useState(false);

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
    <div className="ra-panel">
      <style>{TRANSCRIPT_CSS}</style>
      <p className="ra-intro">{t.intro}</p>

      <label className="ra-row">
        <span className="ra-label">{t.enable}</span>
        <input type="checkbox" role="switch" className="ra-switch" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
      </label>

      <label className="ra-row">
        <span className="ra-label">{t.handsFree}</span>
        <input
          type="checkbox"
          role="switch"
          className="ra-switch"
          checked={s.autoRead}
          onChange={(e) => {
            set('autoRead', e.target.checked);
            setAutoRead(e.target.checked);
          }}
        />
      </label>
      <p className="ra-hint ra-note">{t.handsFreeHint}</p>

      <div className="ra-row">
        <label className="ra-label" htmlFor="ra-voice">
          {t.voice}
        </label>
        <select id="ra-voice" className="ra-select" value={s.voice} onChange={(e) => set('voice', e.target.value)}>
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v === DEFAULTS.voice ? `${t.voiceNames[v]} (${t.defaultWord})` : t.voiceNames[v]}
            </option>
          ))}
        </select>
        <span className="ra-hint">{t.voiceHint}</span>
      </div>

      <div className="ra-row">
        <label className="ra-label" htmlFor="ra-speed">
          {t.speed}
        </label>
        <input
          id="ra-speed"
          type="range"
          className="ra-range"
          min={0.5}
          max={2}
          step={0.05}
          value={s.speed}
          onChange={(e) => set('speed', Number(e.target.value))}
        />
        <span className="ra-speed-value">{formatSpeed(s.speed)}</span>
        {s.speed !== DEFAULTS.speed && (
          <button type="button" className="ra-btn compact" onClick={() => set('speed', DEFAULTS.speed)}>
            {t.reset}
          </button>
        )}
      </div>

      <label className="ra-row">
        <span className="ra-label">{t.skipCode}</span>
        <input type="checkbox" role="switch" className="ra-switch" checked={s.skipCodeBlocks} onChange={(e) => set('skipCodeBlocks', e.target.checked)} />
      </label>

      <label className="ra-row">
        <span className="ra-label">{t.skipTerminal}</span>
        <input type="checkbox" role="switch" className="ra-switch" checked={s.skipTerminalOutput} onChange={(e) => set('skipTerminalOutput', e.target.checked)} />
      </label>

      <div className="ra-row">
        <label className="ra-label" htmlFor="ra-folder">
          {t.ttsFolder}
        </label>
        <input id="ra-folder" className="ra-input" value={dirDraft} onChange={(e) => setDirDraft(e.target.value)} />
        {dirDraft !== s.ttsDirectory && (
          <button type="button" className="ra-btn" onClick={() => set('ttsDirectory', dirDraft.trim() || DEFAULTS.ttsDirectory)}>
            {t.save}
          </button>
        )}
      </div>
      <p className="ra-hint ra-note">{t.folderHint}</p>

      <div className="ra-group">
        <div className="ra-actions">
          <button
            type="button"
            className="ra-btn primary"
            disabled={!s.enabled}
            onClick={() => (testing ? player.stop() : player.play('settings-test', SAMPLE))}
          >
            {testing ? t.stopTest : t.testVoice}
          </button>
          <button type="button" className="ra-btn" disabled={busy} onClick={() => act('warmup')}>
            {t.startEngine}
          </button>
          <button type="button" className="ra-btn" disabled={busy} onClick={() => act('shutdown_worker')}>
            {t.stopEngine}
          </button>
        </div>
        {testError && <p className="ra-error">{testError}</p>}

        <div className="ra-status">
          {statusError && <p className="ra-error">{statusError}</p>}
          {status && (
            <>
              <div className="ra-status-line">
                <span className="ra-label">{t.engine}</span>
                <span className="ra-state">
                  <span className={`ra-dot${STATE_DOT[status.worker]}`} />
                  {STATE_TEXT[status.worker]}
                </span>
                <button type="button" className="ra-link" aria-expanded={details} onClick={() => setDetails(!details)}>
                  {details ? t.hideDetails : t.showDetails}
                </button>
              </div>
              {details && (
                <p className="ra-hint ra-note">
                  {t.engineDetails(status.uptimeSec, status.requestsServed)}
                  {status.loadMs != null ? `. ${t.modelLoaded(status.loadMs)}` : ''}
                </p>
              )}
              {status.missing.length > 0 && <p className="ra-error">{t.missingFiles}</p>}
              {status.lastError && <p className="ra-error">{status.lastError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
