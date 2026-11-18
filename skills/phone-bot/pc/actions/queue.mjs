// A session's waiting messages (actions 14, 15 and 24 of the PC program design). A message sent to a running
// session waits in Nimbalyst's queue until the turn ends; removing one needs the patch's remove_queued_prompt.
import { knownSession } from "../core/db.mjs";
import {
  listQueued,
  needTool,
  removeQueued,
  SESSION_INPUT,
  sendPrompt,
  watchDoor,
} from "../core/door.mjs";
import { movedOn } from "../core/moved.mjs";
import { ActionError } from "../core/registry.mjs";
import { ATTACHMENTS_INPUT, takeAttachments } from "./attach.mjs";
import { TEXT_INPUT } from "./session.mjs";

const QUEUE_ID = { type: "string", min: 1, max: 100 };

export function register(registry) {
  watchDoor();

  // queueId is null when the message already left the queue (the turn ended meanwhile).
  registry.add({
    name: "session.queue",
    input: {
      session: SESSION_INPUT,
      text: TEXT_INPUT,
      attachments: ATTACHMENTS_INPUT,
    },
    run: async (d, ctx) => {
      const { project, row } = knownSession(d.session);
      // A session that handed its work on passes the message, once it leaves the queue, to the one that continues it.
      const moved = movedOn(row, d.text);
      const on = moved ? { movedTo: moved } : {};
      // The ids are taken before the first wait and given back when the send fails.
      const t = takeAttachments(
        d.attachments,
        ctx.device,
        project.path,
        d.text,
      );
      let had;
      let r;
      try {
        had = new Set(
          (await listQueued(project.path, d.session)).map((q) => q.queueId),
        );
        r = await sendPrompt(project.path, d.session, t.text);
      } catch (e) {
        t.giveBack();
        throw e;
      }
      if (r.processingTriggered === true) return { started: true, ...on };
      const added = (await listQueued(project.path, d.session)).filter(
        (q) => !had.has(q.queueId),
      );
      const last = added[added.length - 1];
      return { queued: true, queueId: last ? last.queueId : null, ...on };
    },
  });

  registry.add({
    name: "queue.list",
    input: { session: SESSION_INPUT },
    run: async (d) => {
      const { project } = knownSession(d.session);
      return listQueued(project.path, d.session);
    },
  });

  // Answers the removed message's whole text: a queued message's Edit puts it back in the typing box.
  registry.add({
    name: "queue.remove",
    input: { session: SESSION_INPUT, queueId: QUEUE_ID },
    run: async (d) => {
      const { project } = knownSession(d.session);
      await needTool("remove_queued_prompt");
      const queued = await listQueued(project.path, d.session, { whole: true });
      const q = queued.find((x) => x.queueId === d.queueId);
      if (!q) throw new ActionError("no-queued");
      await removeQueued(project.path, d.session, d.queueId);
      return { removed: true, text: q.whole };
    },
  });
}
