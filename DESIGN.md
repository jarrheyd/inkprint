---
name: inkprint
description: How you work with AI, read back one sentence at a time.
colors:
  ground: "#FAFAF9"
  panel: "#EFEFEE"
  ink: "#111110"
  ink-soft: "#62625E"
  ink-faint: "#9A9A95"
  red: "#C4462F"
  backdrop: "rgba(17, 17, 16, .5)"
  night-ground: "#111110"
  night-panel: "#1C1C1B"
  night-ink: "#F2F2F0"
  night-ink-soft: "#9C9C97"
  night-ink-faint: "#64645F"
  night-red: "#E0735F"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  sentence:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  sentence-phone:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.12
  stat:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "24px"
    fontWeight: 600
  lead:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "17px"
    lineHeight: 1.45
  row:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "15px"
  control:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "14px"
  caption:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "13px"
  figure:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "12px"
  info-mark:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "11px"
  code:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "13px"
spacing:
  gutter: "16px"
  panel-gap: "16px"
  panel-padding: "40px"
  panel-padding-phone: "24px"
  column: "760px"
rounded:
  code: "5px"
  bar: "3px"
  image: "16px"
  panel-phone: "24px"
  panel: "28px"
  pill: "999px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
  pill:
    backgroundColor: "rgba(17, 17, 16, .06)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
---

## Overview

A narrow column of soft gray panels on a near-white ground. Each panel says one thing: a short gray label with an info mark, one big sentence where the numbers are in ink and the words around them are gray, one small picture, and a More button that opens the full tables and charts. You read the page top to bottom in about a minute; the detail is there when you want it.

## Colors

Near colorless. Ink for numbers and bars, gray for words, a lighter gray for arrows and empty cells. One warm red, used only for tension: tense messages, and an arrow when tension or push back went up. Night mode swaps the ground and panel for near-blacks and keeps the same roles.

## Typography

One system sans. The sentence is large and tight (44px, 30px on a phone) with numbers set in ink at the same weight, so the eye lands on them first. Labels, notes and table text sit at 13 to 17px in gray. Tabular figures everywhere. Sentence case only; no tracked caps.

## Layout

A 760px column, 16px between panels, 40px inside each panel (24px on a phone). Order: this week, where you differ, when, projects, how you sound, how you write, words, people, cost. Show names sits in the head of the panels that name people.

## Elevation & Depth

Flat. Panels are separated from the ground by tone only: no borders, no shadows.

## Shapes

Panels 28px round, pills fully round, bars and cells 3px round.

## Components

- Sentence: built from the metrics, never from a model. An arrow follows a number only when it moved more than 10% against your usual, with the old number read out to screen readers.
- Glance: one small picture per panel, either short rows with a thin bar or a strip of columns.
- More: flat tables and charts separated by hairlines.
- Info mark: opens a plain note on what the panel counts.
- Name mask: people's names blurred until Show names is on.

## Do's and Don'ts

- Do say one thing per panel, in a sentence with its numbers.
- Do keep the red for tension only.
- Don't add borders, shadows, gradients, icons or accent colors.
- Don't show a classifier number without saying where it came from, under the info mark or More.
