# Nimbalyst

Nimbalyst is an editor that runs Claude Code chats. Stratus's rules, hooks and skills work in plain Claude Code
too; the extensions and the Sessions board need Nimbalyst. The install builds the extensions and puts them into
Nimbalyst when it is installed (`--extensions no` leaves them out). The [extensions reference](../reference/extensions.md)
lists all of them; this page says what you see.

![The commands button starting a setup audit, and Read Aloud speaking a reply](../img/clip-commands.gif)

## Without Nimbalyst

`/lead` runs its steps as helpers in plain Claude Code too, but keeps its job card in Nimbalyst's tracker. The
checks on question cards, command lines, file links and pictures are written for Nimbalyst's chat.
[Terminal Claude Code and Nimbalyst](../reference/platforms.md#terminal-claude-code-and-nimbalyst) lists each part
that needs Nimbalyst.

## The Commands button

A lightning bolt in the left sidebar. It opens a short list of commands in four groups, most-used first:
lead, grill me, next move, where are we, board cleanup; new project, update project, systems map, untangle; setup audit, update
setup, backup; PC tidy, disk tidy. Setup audit opens its checks in place. Press one and a new chat starts in the open
project with that command; you should see it in the sessions list. The extension also adds the **Note** button next
to Send ([Everyday work](everyday-work.md#a-note-to-a-busy-session-btw)). A **Try it** button beside Note asks the
session to run the project's verify skill and, when the change has a local page, opens that page in a tab beside
the chat. In the Review panel, a **+** by a diff line opens a comment box; the bar at the foot of the panel sends all
comments as one message.

## The Agents & commands list

In the right sidebar, the `agents-panel` extension lists the helpers and background commands Claude has started.
Running items are on top; finished ones fold behind an "N done" line. Each row is named after its job, for
example `Web search: library sign-in steps` (a command by its `# WHAT THIS DOES:` line); hover a row to see the full
command. Drag the list's bottom edge to make it taller. The extension also keeps the commit panel inside a narrow
sidebar, and keeps a chat you scroll up in where you put it.

## Job tracker

The `job-tracker` extension turns Nimbalyst's tracker into one page per project for the job in hand: its name and
goal, how many steps are left with a bar, and four folds for what needs you, what is running, what is left and what
is done. Every new job gets numbered stages, and what is left is listed in the order it runs. Click the job's name to
switch to another. A step with a file to read opens it in one click, and a step with a session opens that session.
The session you are in stays open on the right of the page; pick another on the left, drag its edge to resize it, or
hide it with the Chat button. `/where-are-we` brings the steps up to date.

## Board Tidy

The `board-tidy` extension keeps the Sessions board to current work. Once an hour, in every project, it archives
sessions that are Complete and idle for 3 days, have no phase and are idle for 14 days, or have sat in planning,
validating or implementing for 30 days. Pinned, running and worktree sessions stay, and nothing is deleted.

A project where each chat is its own task you may look up months later can be kept: nothing there is archived unless
you ask ("archive what's older than 6 months there"). The install keeps `quick-tasks`, `/new-project` asks, and
"stop tidying this project" or "tidy it again" changes it.

## Systems map

The `systems-map` extension draws the open project's [systems map](systems-map.md) as a graph you can pan, zoom and
search, coloured by group, with a card for each part: its files, notes and links. A link whose code changed is
marked, and a project with no map gets a button that starts a session to build one.

## Themes

The `ink-themes` extension adds eleven colour themes with their own fonts and rounder shapes: eight dark (Ink
Aurora, Ivy, Graphite, Tide, Ember, Noir, Cobalt, Neon) and three light (Ink Bone, Frost, Blossom). Press the
**Theme** button at the bottom of the left sidebar, press **Ink themes** to unfold the list, and pick one. The
install switches Nimbalyst to Ink Cobalt once, when no theme is picked yet or the theme is not an Ink theme. A theme
you pick after that stays. `--no-theme` leaves the theme alone.

![The eleven themes, one after another on the same window](../img/clip-themes.gif)

## Usage Plan and Read Aloud

The Usage Plan button is described on [Usage](usage.md#the-usage-plan-button), and Read Aloud on
[Voice and phone](voice-and-phone.md#read-aloud).

## Nimbalyst's own tools

At the start of a session inside Nimbalyst, a hook tells Claude two quirks of Nimbalyst's tools, so they don't sit
in the rules of every session. Nimbalyst updates on Windows are covered in
[Install options and updates](install-and-update.md#nimbalyst-updates-on-windows), and each fix Stratus puts
into Nimbalyst in [Nimbalyst patches](../how-it-works/nimbalyst-patches.md).
