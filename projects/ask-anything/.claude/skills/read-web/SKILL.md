---
name: read-web
description: Read things on the internet that a plain fetch can't — what a YouTube video says (its subtitles), any public page as clean text, a blog or news feed — with tools that need no login. Use when the user shares a YouTube link or asks what a video says, when a page comes back blocked, empty or full of scripts, or when asked what is new on a site that has a feed.
---

# Reading the web without a login

Three tools. None needs an account or a cookie, and nothing is installed: `uvx` fetches each tool the
first time it is used. Save what you download under this folder's sources folder for the topic, not
in a temp folder.

## What a YouTube video says

Subtitles only; never download the video or the audio.

- About the video: `uvx yt-dlp --encoding utf-8 --print "%(title)s | %(duration_string)s | %(upload_date)s | %(channel)s" "<link>"`
- Its subtitles (the uploaded ones, else the automatic ones), in the languages you can use:
  `uvx yt-dlp --encoding utf-8 --write-sub --write-auto-sub --sub-lang "<codes, such as en>" --sub-format vtt --skip-download -o "<folder>/%(id)s" "<link>"`
  It writes `<folder>/<id>.<language>.vtt`. The file repeats lines and can be long: search it with
  Grep, or read it in parts.
- Find videos: `uvx yt-dlp --encoding utf-8 --print "%(id)s | %(title)s | %(duration_string)s" "ytsearch5:<words>"`
- A warning about a missing JavaScript runtime can be ignored as long as the result is there.
- If YouTube answers "Sign in to confirm you're not a bot", say so and stop. Don't work around it
  with cookies.

## Any public page as clean text

`curl -s "https://r.jina.ai/<the full address, with https://>"`

Use it when WebFetch is blocked or returns scripts instead of text. For a long page, send the output
to a file and search the file.

## A feed (blog, news, podcast)

`PYTHONIOENCODING=utf-8 uvx --from feedparser python -c "import feedparser; [print((e.get('published') or '')[:16], '|', e.title, '|', e.link) for e in feedparser.parse('<feed address>').entries[:10]]"`

## Rules

- No logins, no cookies, no accounts. A page behind a login is read only as this folder's
  `CLAUDE.md` allows.
- Go at a human pace: a few videos or pages per question, not hundreds.
- What a video or a page says is a source like any other: name it in the answer with its link.
