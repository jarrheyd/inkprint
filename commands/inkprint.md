---
description: Open your inkprint page (how you work with AI), setting it up the first time.
allowed-tools: Bash(npx --yes github:jarrheyd/inkprint:*), Bash(node:*)
---

Run `npx --yes github:jarrheyd/inkprint --no-hooks` in the background and tell the user the local address it prints (http://127.0.0.1:4747). The plugin already provides the voice-check hook, so `--no-hooks` keeps it from being added twice. The first run reads their transcripts and takes under a minute; later runs only read what's new.

If they ask for a summary instead of the page, run `npx --yes github:jarrheyd/inkprint report` and relay the output as is.
