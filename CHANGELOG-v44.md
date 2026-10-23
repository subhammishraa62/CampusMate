# CampusMate v44 — Daylight scrollbar polish

- Replaced the purple Daylight scrollbar with a muted blue-grey thumb and a translucent track that better blends into the Daylight background.
- Kept Sky Purple scrollbars lavender with a deep violet track.
- Removed hard-coded purple scrollbar colors from the task editor/profile modal scrolling rules; all scrollable regions now use the selected theme's scrollbar tokens.
- Applied the same theme-aware tokens to Firefox's `scrollbar-color` and Chromium/WebKit scrollbar pseudo-elements.

## Quick check
1. Switch Preferences to Daylight and check the page, sidebar, and task editor scrollbars: they should be soft blue-grey, not purple.
2. Switch to Sky Purple: scrollbars should return to lavender over a dark violet track.
3. Open a long task form and scroll within the form to check that modal scrolling follows the same palette.
