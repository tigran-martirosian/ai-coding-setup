// Projects and pins (actions 3 and 4 of the PC program design). The phone sees a project handle, never a path.
// A project whose folder is gone is left out: it would only fail when opened.
import fs from "node:fs";
import { projectCounts } from "../core/db.mjs";
import {
  listProjects,
  PROJECT_INPUT,
  projectByHandle,
  watchDoor,
} from "../core/door.mjs";
import { readState, updateState } from "../core/state.mjs";

export function register(registry) {
  watchDoor();

  registry.add({
    name: "projects.list",
    run: () => {
      const counts = projectCounts();
      const pinned = new Set(readState().pinned || []);
      return listProjects()
        .filter((p) => fs.existsSync(p.path))
        .map((p) => {
          const c = counts.get(p.path);
          return {
            project: p.project,
            name: p.name,
            needsYou: c ? c.needsYou : 0,
            working: c ? c.working : 0,
            lastUsed: c ? c.lastUsed : null,
            pinned: pinned.has(p.project),
          };
        });
    },
  });

  registry.add({
    name: "projects.pin",
    input: { project: PROJECT_INPUT, pinned: { type: "boolean" } },
    run: (d) => {
      projectByHandle(d.project);
      updateState((s) => {
        const set = new Set(s.pinned || []);
        if (d.pinned) set.add(d.project);
        else set.delete(d.project);
        s.pinned = [...set].sort();
      });
      return { pinned: d.pinned };
    },
  });
}
