# Takeoff and opening review

Open **Openings & specs** from a project’s Plan Takeoff or a saved measure sheet. The AI quoting screen uses the same editor when it needs information.

## Measure deliberately

Choose whether a new width is an opening width, wall-to-wall run or finished track width. The plan line keeps its original scaled reading. The shared opening editor has a calculator for width adjustments, track/carrier deductions, floor clearance and window overlaps. Blank adjustments are not assumed to be zero. Applying a calculation changes only unsaved answers; Save answers commits the reviewed finished sizes. Height measurements made on elevations are references, not finished manufacturing drops.

## Complete one shared opening record

Fabric, layers, heading, operation request, track model, recess, fixing and colours are edited against the existing measure-sheet line ID. Takeoff panels read those answers back, and newly created draft quotes retain the source ID, reviewed calculations and plan references. Sent quotes are unchanged. When a job has multiple sheets the editor identifies its sheet, and drawing an existing unplaced opening binds back to that exact sheet row.

For manual and automated alternatives, select separate hardware models. New draft creation expands them into one Multiple Choice group, with both choices linked to the same source opening. The source quantity remains the physical opening quantity. No motor power or hardware price is guessed.

## Shared answers and customer briefs

Bulk edit previews field changes before applying them. Existing answers are protected by default; replacing them requires choosing that option. Only selected openings are affected. Bulk changes remain unsaved until Save answers.

Customer brief review uses the existing signed-in job assistant. Every proposal must quote an exact source excerpt, target a current opening ID or name a proposed missing opening, and use approved specification fields. Dimensions cannot be changed by brief proposals. Select only the proposals reviewed; conflicting answers for the same field cannot be applied together. New scope starts unmeasured with its count and mapping unconfirmed.

## Find heights and source drawings

Read all plan pages, search room names, window IDs, ceiling heights, bulkheads and sections, and attach file/revision/page references to an opening. The AI can suggest explicitly printed ceiling or window heights, with exact excerpts, for manual mapping review. It cannot apply them as finished drops. The calculator separately requires the measurement basis and deductions. Scanned pages need visual inspection; text extraction and AI context limits mean source drawings still need checking.

## Plan revisions and ordering

A changed plan dimension proposes a change rather than replacing a non-empty answer. Site dimensions, selected fabrics and other confirmed specifications remain intact. Removed markup retains the sheet entry with an unresolved scope flag. Carrying markup onto another revision requires explicit comparison/review. New revision history entries retain the markup snapshot, enabling restoration with the matching plan file; older history entries created before this feature may not contain such a snapshot.

Plan estimates, unresolved scope/counts, removed openings and pending plan/revision changes keep the ordering hold. Normal site check-measure controls remain in the measure-sheet editor. Specification edits retain before/after values and allow previous values to be restored as an unsaved edit.

## Validation

Pure workflow tests cover calculation requirements, protected bulk previews, source-citation validation and exclusive operation alternatives. An isolated test loads the real store implementation with fake storage/database adapters and verifies plan-to-sheet reconciliation, revision/removal holds, height semantics and exact sheet ownership. The UI preview uses fictional openings and never saves to a live customer job.
