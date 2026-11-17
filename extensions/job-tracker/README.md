# Job Tracker (Nimbalyst extension)

Turns Nimbalyst's tracker into one page per project that shows the job in hand: what needs you, what is
running and what is left. A job is any work that takes more than one session. It is a tracker item named after
the work, and its steps are the items linked to it (one step per plan row, written by the `where-are-we`
skill).

- **Header.** The job's name and goal. The name is also the picker: "All open" (every open job on one list),
  each open job newest first, "Not in a job" for items no job holds, and the finished jobs below.
- **How much is left.** The steps left in large type, then "141 of 150 done (94%) · 0 running" over a bar;
  hover a part of the bar for what it holds.
- **Three facts.** Needs you, Running now, Work left; a click opens the matching list.
- **Four folds.** Needs you, Running, To do, Done. Running holds only steps a session works on right now; a
  step marked in progress with no session on it waits under To do. Switches above them show Steps, Bugs,
  Decisions, Ideas or All.
- **The session's state on each row.** A running step says what its session does ("editing files"), or "needs
  you" when the session waits on you, as the phone app says it, or "no change since 14 Nov 15:52" when the session
  had no change for a day. A started step whose session no longer runs says "session ended 13:52". There is no
  error word: the app ends a failed session at once and keeps no record of the error.
- **Done on Needs you.** Each Needs you row has a Done button: it sets the step done, and the row moves to Done.
  When the tracker does not save it, the row stays and says so. A row that waits on other steps names their titles.
- **Old jobs leave.** A job released or cancelled 3 days ago is archived when the page reads, so it leaves the
  picker; Nimbalyst's own tracker can bring it back.
- **One click to open.** A step that asks you to read a file shows the file under its title: a click opens it
  in the editor. A step with a session opens that session; a click on the row opens the step itself.
- **A step's own view.** One main button, "Open session"; the rarely used fields fold behind "More fields" and
  the history behind one "History and details" line.

- **The chat on the right.** The session open in the Sessions view stays beside the page, so you can keep working
  in it; a click on a session on the left changes it, and "Open session" on a step picks that session there. The
  chat is 420 px wide from a 1440 px window and 340 px below it; drag its edge between 300 and 640 px (the page
  keeps at least 480 px). The Chat button in the header hides or shows it; below a 1200 px window it starts hidden.
  A step opens beside the list when the list keeps 440 px, else in its place with a "Back to <job>" line.

The page opens on the open job with the newest activity. The app's left tracker column is hidden while the
page is on. The extension writes the tracker in two ways only, both through the app's own calls: the Done
button's status change and the archive of old finished jobs. It reads the app's page markup
(`src/selectors.js` lists the selectors), so an app update may break it; then the tracker shows as before and
the console says why (its lines start with `job-tracker:`).

## Build and install

No npm install needed: `npm run install-ext` (or `node build.mjs --install`) builds `dist/` and copies it into
Nimbalyst's extensions folder as `jobtracker`. Restart Nimbalyst afterwards: switching an extension off and on
does not reload its code.

## Tests

`node test.mjs` runs the quick checks; `node test.mjs --pictures` also draws `test/fixture.html` in a local
Chromium under Ink Aurora and Ink Bone, at 1920 and 2560 wide, and checks the layout.
