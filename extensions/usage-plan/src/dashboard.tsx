/**
 * The full usage dashboard: a second, fullscreen panel of this extension.
 *
 * Nimbalyst draws a gutter button for every fullscreen panel itself and ignores an extension's own gutter button
 * (read from the app's code). So the side bar keeps one Usage icon through a style that hides the
 * dashboard's button, and the "Full dashboard" button in the popover clicks that hidden button.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PanelHostProps } from "@nimbalyst/extension-sdk";
import "../../shared/tokens.css";
import { buildDashboard, readDashboardFile } from "./command";
import {
  canStartBuild,
  initialState,
  needsBuildOnOpen,
  parseDashboard,
  reduce,
} from "./dashboard-data";
import type { DashboardData } from "./dashboard-data";
import { DashboardView } from "./dashboard-view";
import { failureLine } from "./format";
import { t } from "./strings";

const READ_MS = 30_000;
const BUILD_MS = 240_000;

export const DASHBOARD_BUTTON =
  'button[data-panel-id="com.local.usageplan.usage-dashboard"]';
const STYLE_ID = "usage-dashboard-hide-button";

/** Hides the dashboard's own gutter button, and a wrapper of it that holds nothing else. */
export function hideDashboardButton() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${DASHBOARD_BUTTON}, :has(> ${DASHBOARD_BUTTON}):not(:has(> :nth-child(2))) { display: none !important; }`;
  document.head.appendChild(style);
}

export function unhideDashboardButton() {
  document.getElementById(STYLE_ID)?.remove();
}

/** Shows the dashboard panel in the main area. Fails loudly when the app has not drawn the dashboard's button. */
export function showDashboardPanel() {
  const button = document.querySelector<HTMLButtonElement>(DASHBOARD_BUTTON);
  if (!button)
    throw new Error(
      "usage dashboard: Nimbalyst drew no gutter button for the dashboard panel (hidden in the gutter menu, or the extension did not load)",
    );
  // A second click on an open fullscreen panel closes it; the dashboard stays open instead
  if (button.getAttribute("aria-pressed") === "true") return;
  button.click();
}

type HostExec = PanelHostProps["host"]["exec"];

/** The file's data, or null when there is no file yet. Throws with the reason when the read or the content fails. */
async function readData(exec: HostExec): Promise<DashboardData | null> {
  const r = await exec(readDashboardFile(), { timeout: READ_MS });
  if (r.exitCode === 2) return null;
  if (!r.success)
    throw new Error(failureLine(r.stderr, `exit code ${r.exitCode}`));
  return parseDashboard(r.stdout);
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reads the file at once, rebuilds in the background when it is missing or stale, and offers the same rebuild on demand. */
function useDashboard(exec: HostExec) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const building = useRef(false);

  const rebuild = useCallback(async () => {
    // The ref also covers two presses in the same moment, before React has drawn the new status
    if (building.current || !canStartBuild(stateRef.current)) return;
    building.current = true;
    dispatch({ type: "build-start" });
    try {
      const r = await exec(buildDashboard(), { timeout: BUILD_MS });
      if (!r.success)
        throw new Error(
          t.buildFailed(
            failureLine(
              r.stderr,
              `exit code ${r.exitCode}, it may have timed out`,
            ),
          ),
        );
      const data = await readData(exec);
      if (!data)
        throw new Error(t.buildFailed("the build finished but wrote no file"));
      dispatch({ type: "read-ok", data });
    } catch (e) {
      console.warn("[usageplan] dashboard build:", reasonOf(e));
      dispatch({ type: "build-failed", reason: reasonOf(e) });
    } finally {
      building.current = false;
    }
  }, [exec]);

  useEffect(() => {
    let live = true;
    (async () => {
      let data: DashboardData | null;
      try {
        data = await readData(exec);
      } catch (e) {
        console.warn("[usageplan] dashboard read:", reasonOf(e));
        if (live)
          dispatch({ type: "read-failed", reason: t.readFailed(reasonOf(e)) });
        return;
      }
      if (!live) return;
      dispatch(data ? { type: "read-ok", data } : { type: "read-missing" });
      if (needsBuildOnOpen(data, Date.now())) rebuild();
    })();
    return () => {
      live = false;
    };
  }, [exec, rebuild]);

  return { state, rebuild };
}

export function UsageDashboardPanel({ host }: PanelHostProps) {
  // Called through host: the method reads its own `this`, so passing host.exec on its own breaks it
  const exec = useCallback<HostExec>(
    (command, options) => host.exec(command, options),
    [host],
  );
  const { state, rebuild } = useDashboard(exec);
  return <DashboardView state={state} onRefresh={rebuild} />;
}
