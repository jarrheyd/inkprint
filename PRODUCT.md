# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who run their own OS on Claude Code or Codex with helm-os. The first user is the maintainer, who works with AI tools all day across client projects, internal tools and personal apps. The usage dashboard is built around his data and reading habits, and every label, empty state and default has to work for a stranger who installs helm-os on a different machine with different projects.

## Product Purpose

helm-os is a framework you clone into your own vault: a daily brief, project tracking, a write-ledger, and a usage routine. The usage routine shows people how they think and work with AI, in context, from their own transcripts. Success is a person opening it once a week and finding something true about themselves they did not already know: where they push back, when they write short, which project or person changes their tone.

## Positioning

Local and file based. It reads transcripts already on disk, keeps numbers in plain files, keeps words and people on the machine only (`.nosync`), and scores tone with a classifier trained once from a small model's labels, so per-message analysis costs zero tokens. Hosted analytics tools cannot see the transcripts, and generic sentiment models misread how a given person writes.

## Operating Context

- Opened from a terminal command that starts a localhost page; closed when done. Also a nightly static snapshot.
- Main moment: a weekly look back. Insight sentences lead; charts back them up.
- Data sources: Claude Code transcripts (`~/.claude/projects`) and Codex rollouts (`~/.codex/sessions`).
- Two layers in every view: what the person typed, and what their automation did.

## Capabilities and Constraints

- Usage volume, streaks, activity by day and hour, projects by time and messages, words and phrases, particles, push-back rate, questions, laughs, late-night share.
- Context comparisons by project and by person, in plain sentences.
- Tone per message from a local classifier: polarity is the reliable read; seven-way mood is shown as a mix, not per message.
- Machine side: API-equivalent cost, tokens by model, tool calls, split by person vs OS. Subscription users are not billed these amounts.
- People names are sensitive: hidden by default, one reveal control.
- No external requests, no dependencies, single HTML file.

## Brand Commitments

Plain, human language. No marketing tone, no hype. Copy speaks to the reader as "you".

## Evidence on Hand

Real data only, from the user's own transcripts. No sample or invented numbers ship in the page. Empty states say what is missing and how to get it.

## Product Principles

1. Insight over inventory: lead with where you differ, not with totals.
2. Your words stay yours: text-derived data never leaves the machine.
3. Honest numbers: say "API-equivalent", show sample sizes, never overstate what the classifier knows.
4. Works for a stranger: nothing assumes one person's projects, language or schedule.

## Accessibility & Inclusion

Readable in light and dark, usable at phone width, color never the only carrier of meaning in charts.
