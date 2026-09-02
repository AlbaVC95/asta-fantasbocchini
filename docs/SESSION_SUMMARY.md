# Session Summary

## What we accomplished
- **Admin Layout Fix (Single Line Card):** Removed the restrictive `max-width` on the player card when the "Anteprima" side drawer is open in Admin view. It now flexes correctly so that long names (like "FAVASULI") stay strictly on one line and do not truncate or break to a second line.
- **Admin Layout Fix (Timer & Rilancia Alignment):** Implemented a CSS Grid layout specifically scoped to when the "Anteprima" drawer is open. The player card now occupies the full left height, and the timer is elegantly stacked directly on top of the "Rilancia" bidding controls on the right.
- **Admin Panel Z-Index Fix:** Fixed a layout bug where the `admin-panel` confirmation buttons ("Conferma", "Riapri", "Tutti a 0?") were being cut off underneath the player card row when the timer expired. Elevated the `z-index` of the panels row to ensure admin popups always stay fully clickable and visible above the main bidding interface.
- **Excel Import Logic (R.MANTRA Prioritization):** The Fantaleghe Excel import routine was reading the classic `R.` column even when `R.MANTRA` was present in the file. Refactored the `findCol` logic to actively seek `R.MANTRA` first, preserving accurate Mantra roles (e.g., Pc, W) and falling back to `R.` only for classic league setups.
- **Per-Team Svincoli Override:** Added a new per-team input field ("Svincoli usati") in the Admin Settings modal alongside "Recompra". This field automatically appears only in `riparazione` mode, allowing the admin to explicitly override the number of *used* svincoli on a team-by-team basis, enabling precise control over their remaining svincoli allowances derived from the global `svincoliTotali` cap.

## State of the codebase
- The codebase logic and styling for Asta di Riparazione is fully aligned with user requirements. 
- All changes were progressively deployed, successfully tested, and merged into the main Git branch.
