// Buttons for skills that exist only on one computer go here. `npm run build:share` leaves them out.
import type { Command } from "./commands";
import { t } from "./strings.ts";

export const OWN: Command[] = [
  {
    id: "phone",
    label: t.commands.phone.label,
    prompt: "/phone",
    note: t.commands.phone.note,
    icon: "smartphone",
    group: 4,
  },
];

// Ids of buttons in commands.ts to leave out on this computer.
export const HIDE: string[] = [];
