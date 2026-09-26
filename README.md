# inkprint

See how you work with AI, from the transcripts already on your machine, and stop drafts that don't sound like you.

I built this because I spend most of my day in Claude Code and Codex and had no idea what that looked like: which projects actually took my time, when I push back, how tense I get on which project, how I write to which person. Everything it needs is already on your disk, so it runs there and nowhere else.

- **your page**: a live page on localhost. Messages, streaks, the hours you work, projects by time, the words and phrases you repeat, how you sound week to week, and the part I find most useful: where you change by project or by person ("on one project you push back twice as often", "when a certain teammate comes up you ask more questions").
- **your voice**: cards of how you actually write in each channel and to each person, measured from your own sent messages (words per message, whether you split a thought into several sends, greetings, sign-offs, casing, the rules you keep repeating to your AI). A hook checks every draft your AI writes for you against the right card and stops the ones that don't fit before you see them.
- **your week as an image**: one button makes a card you can post. Project and people names are swapped out unless you keep them.

## Install

```bash
npx github:jarrheyd/inkprint
```

That's the whole setup. It reads your transcripts (under a minute the first time, only new lines after that), schedules a nightly refresh, adds the voice check to Claude Code and Codex, and opens the page. Run it again any time to reopen the page.

Claude Code, as a plugin instead:

```bash
claude plugin marketplace add jarrheyd/inkprint
claude plugin install inkprint@inkprint
```

Then `/inkprint` opens the page. Pick one route; the plugin brings its own hook.

Undo everything:

```bash
npx github:jarrheyd/inkprint uninstall          # keeps your data
npx github:jarrheyd/inkprint uninstall --data   # removes it too
```

## Where your voice comes from

Nothing to connect or export. It builds from what's already there:

- how you write to your AI (your prompts)
- what you tell your AI after it drafts something ("too long", "no em dashes", "sounds like AI"). Say one twice and the check enforces it
- your own messages, whenever your AI reads a chat or an inbox for you (Gmail, Discord, Telegram, WhatsApp, Google Chat, Teams). Only messages you sent are kept, and anything your AI sent in your name is left out
- a WhatsApp bridge database, if you run one

Cards fill in as you work. Each one says what it's built from, so a card made only from your prompts never passes for your Discord voice.

## What it costs

Nothing, in tokens. Every number on the page is counted on your machine, and mood comes from a small model that ships with inkprint. If you want the mood read tuned to you, the page has a button: it sends 800 of your messages through your own `claude` or `codex` CLI to be labeled (about 120k tokens once, on your plan), then trains locally. It never runs without that click.

## Your data stays yours

Everything lives in `~/.inkprint` and nothing gets uploaded: the page is served on `127.0.0.1` only, your message text stays on the machine, and the share card is drawn in your browser and saved as a file.

## Requirements

macOS and Node 22.5 or newer, plus Claude Code or Codex history to read. Linux works for everything but the nightly job.

## Layout

```
bin/inkprint.js       the CLI
lib/usage             transcripts in, numbers out
lib/voice             voice cards and the check
lib/harvest           your own messages, found in what your AI read
lib/corrections.js    the rules you give your AI
lib/setup.js          the nightly job and the hooks, and taking them out
page/index.html       the page
models/               the mood model that ships
.claude-plugin/       plugin and marketplace manifests
test/                 node:test, run with npm test
```

## License

[FSL-1.1-MIT](./LICENSE.md): use it, change it, run it at work, free. You can't sell a competing product built on it. Each version turns into plain MIT two years after release.
