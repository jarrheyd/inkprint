---
name: helm-os usage
description: How you work with AI, read back as an engineer's computation pad.
colors:
  pad: "#E6EFD8"
  grid-minor: "#CFE0B8"
  grid-major: "#B3CB93"
  ink: "#1B2617"
  ink-soft: "#46573B"
  margin-red: "#B7362F"
  graphite-blue: "#2D5886"
  mood-pos: "#276346"
  mood-flat: "#7B8B70"
  mood-neg: "#B7362F"
  night-pad: "#0E1810"
  night-grid-minor: "#18271B"
  night-grid-major: "#223826"
  night-ink: "#DBE7CD"
  night-ink-soft: "#9FB291"
  night-margin-red: "#E2675E"
  night-graphite-blue: "#86AEDB"
  night-mood-pos: "#7FC79F"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  sheet-title:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
  code:
    fontFamily: "{typography.figure.fontFamily}"
    fontSize: "13px"
  note:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "16px"
    lineHeight: 1.45
  field-label:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "11px"
  caption:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "12px"
  control:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "13px"
  field-value:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "20px"
    fontWeight: 600
spacing:
  grid: "16px"
  sheet-gap: "64px"
rounded:
  none: "0px"
  control: "3px"
components:
  toggle:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
---

## Overview

The page is a computation pad: pale green engineering paper with a 16px minor grid and an 80px major grid, a red vertical margin rule on the left, and a title block at the top filled in like the printed header of a real pad. Each section is a sheet separated by a perforation. Findings are margin conclusions written beside the plot they come from. Charts are drawn in ink on the grid, never boxed in cards.

## Colors

Restrained: paper, ink, and one red. The red is the margin rule, today's marker, and negative mood. Graphite blue carries the machine (OS) series only. Mood uses red / flat gray-green / deep green, always paired with a label or position so color is never the only signal. Night mode is the same pad after dark: green-black paper, pale ink, the grid barely visible.

## Typography

One system sans for everything readable. Monospace only for measurements and figures in tables and axes. Sheet titles are sentences in sentence case, never tracked caps. Numbers use tabular figures.

## Layout

Desktop: a left margin column (about 30%) for conclusions, the red rule, then the plot column. Under 760px the margin notes stack above their plot and the rule moves to the top edge of each note. Everything aligns to the 16px grid. More space above a sheet title than below it.

## Elevation & Depth

Flat. Paper has no shadow. Depth comes only from ink weight and the grid behind.

## Shapes

Square corners. Bars and cells are plain rectangles. Controls get a 3px corner and a 1px ink border.

## Components

- Title block: a ruled table with small field labels in sentence case and handwritten-size values.
- Margin note: a sentence, then the two numbers it compares on a small dot-and-line gauge.
- Plot: SVG, ink strokes, axis labels in figure type, no chart chrome.
- Name mask: people's names blurred until the reader turns on "Show names".

## Do's and Don'ts

- Do draw on the grid; do write findings as sentences.
- Don't use cards, shadows, gradients, tracked uppercase labels, or section numbers.
- Don't show a number without its sample size when it comes from the classifier.
