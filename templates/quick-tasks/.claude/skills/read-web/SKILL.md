---
name: read-web
description: Read things on the internet that a plain fetch can't — any public page as clean text, a blog or news feed — with tools that need no login. Use when a page comes back blocked, empty or full of scripts, or when asked what is new on a site that has a feed. Not for videos: a YouTube link or a question about a video goes to the watch skill.
---

# Reading the web without a login

Three tools. None needs an account or a cookie, and you install nothing: `uvx` fetches yt-dlp and
feedparser the first time each is used, and `read-page.mjs` uses Firecrawl Local where it is installed
and otherwise fetches defuddle through `npx`. Save what you download under this folder's sources folder for the topic, not
in a temp folder.

## Videos

A YouTube link, or a question about what a video says or shows, goes to the `watch` skill.

To find videos on a topic: `uvx yt-dlp --encoding utf-8 --print "%(id)s | %(title)s | %(duration_string)s" "ytsearch5:<words>"`

## Any public page as clean text

`node ~/.claude/workers/read-page.mjs "<the full address, with https://>"`

Use it when WebFetch is blocked or returns scripts instead of text. It saves the page's words as
markdown and prints the file's path; read that file, and for a long page search it with Grep.

## A feed (blog, news, podcast)

`PYTHONIOENCODING=utf-8 uvx --from feedparser python -c "import feedparser; [print((e.get('published') or '')[:16], '|', e.title, '|', e.link) for e in feedparser.parse('<feed address>').entries[:10]]"`

## Rules

- No logins, no cookies, no accounts. A page behind a login is read only as this folder's
  `CLAUDE.md` allows.
- Go at a human pace: a few videos or pages per question, not hundreds.
- What a video or a page says is a source like any other: name it in the answer with its link.
