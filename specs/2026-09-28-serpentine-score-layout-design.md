# Serpentine Score Direction Design

Date: 2026-09-28
Status: Draft for user review

## Goal

Let a viewer choose how a long score is laid out and traversed. In serpentine mode, successive score systems alternate direction while every animated note remains attached to its matching notehead.

## User-facing setting

Add a `曲谱方向` setting with two choices:

- `蛇形` — selected by default, based on the user's requested direction.
- `标准` — preserve the existing conventional left-to-right engraving.

The control belongs with the existing preview settings and applies to the full score immediately.

## Serpentine layout

- System 1 runs left to right.
- System 2 runs right to left.
- System 3 runs left to right, continuing this pattern for every system.
- The direction alternation continues across page boundaries; it does not reset at each page.
- The treble and bass staves within one grand-staff system share the same direction.
- On right-to-left systems, move the note groups to reversed horizontal positions while keeping note glyphs, stems, beams, clefs, and text upright. Do not mirror the rendered notation image.
- Keep each event's MIDI time and `scoreId` paired with its original notehead; update its displayed coordinates along with the layout transform.

## Motion and camera

- Animate events in MIDI time order along their displayed notehead coordinates.
- At a right edge, route down and continue from the next system's right edge toward the left.
- At a left edge, route down and continue from the next system's left edge toward the right.
- The ball, its trail, and the following camera use the same direction-aware path.
- `这样循环` means alternating direction per score system. Playback-end/restart behavior remains the existing behavior.

## Standard mode

Keep existing engraving coordinates and conventional left-to-right system traversal. The same event-to-notehead mapping remains active.

## Data and state

Store the direction in the existing persisted view settings so it survives refreshes. Imported project data remains compatible: absent direction uses `蛇形` as the default; saved settings can select `标准`.

## Validation

- Confirm standard mode keeps current score layout and event positions.
- Confirm serpentine mode alternates systems and keeps notation symbols upright.
- Confirm MIDI events still land on their corresponding noteheads in both directions.
- Inspect right-edge and left-edge turns on a multi-system score and confirm camera/trail follow the same route.
- Build the app and inspect the actual browser preview.

## Assumptions to confirm

The user has not explicitly chosen the initial default or specified page-boundary behavior. This draft assumes serpentine by default and continuous alternation across pages, consistent with the requested repeated left-right / right-left direction pattern.
