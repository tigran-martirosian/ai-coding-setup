# Web pages and videos

Claude reads web pages and videos the cheapest way that still gives it the words it needs, and tags each research
finding with how well it is sourced.

## Web pages

The `web-research` skill picks the way to read a page:

- **A quick question:** a quick fetch of the page.
- **A quote or documentation:** the exact text saved to a file with `node ~/.claude/workers/read-page.mjs <url>`.
  It reads the page with Firecrawl Local (a page-to-text crawler that runs on your computer) when that is installed,
  and with defuddle (a page-to-text tool fetched through npx) otherwise. A page that blocks Firecrawl Local goes to Firecrawl's cloud, so its address leaves your computer; set `FIRECRAWL_CLOUD=off` to keep it local. It refuses private and local addresses.
- **A GitHub repository:** the `gh` command.
- **A page built by script, a signed-in page or one that refuses the rest:** `peek.mjs` in the `quick-tasks` folder,
  which reads the page in Nimbalyst's browser with your sign-ins. When Nimbalyst's browser can't be reached,
  `peek.mjs` stops and says why. It prints the Nimbalyst browser call that opens its session by hand (inside
  Nimbalyst, Claude can make that call and run `peek.mjs` again), and it names `read-page.mjs` for a public page.
  In a terminal, `read-page.mjs` is the way left.

A page that a decision rests on is saved whole with `read-page.mjs` (or, for a page only `peek.mjs` can open,
`peek.mjs --save <file>`), and a `worker` helper reads all of it.

To sign in to a site, the `site-login` skill opens a real browser window.

`/deep-research`, a command of Claude Code itself, runs only from the Claude Code terminal. In an app or a headless run it skips its approval stop and
can't be stopped, so a hook refuses it there ([Checks](checks.md#guards-on-risky-actions)).

## How solid a finding is

A research report opens with the answer, and each finding carries one tag:

- **Solid** (three or more independent current sources agree)
- **Thin** (one or two independent sources)
- **Ours** (Claude's own reasoning or test)
- **Old** (only evidence from before 2025, or from older Claude models)

A recommendation never rests on an Old finding.

## Videos: `/watch`

Type `/watch <link or file> [question]`, or give Claude a YouTube link or a video file and a question. A script
turns the video into timed words and sheets of 9 timed stills: an overview of the whole video, or about 5 stills a
second for one stretch. A cheap helper reads them, so looking through a video costs a few thousand tokens. The
files are kept in `~/.claude/video-cache`, so a second look downloads nothing.

A video with no subtitles, or one YouTube refuses them for, is listened to: its sound is turned into text on your
computer. That uses ffmpeg's whisper filter and a 574 MB speech model that Claude asks before downloading; where
ffmpeg has no whisper filter, it uses faster-whisper through uv. On a long video this can take minutes. `--listen`
listens even when there are subtitles.

`/watch` needs ffmpeg, and yt-dlp for links. The full list of programs is in
[Dependencies](../reference/dependencies.md).
