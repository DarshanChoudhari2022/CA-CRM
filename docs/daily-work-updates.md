# Optional daily work update and shift time

12 October 2026.

The attendance Overview now includes “Tasks performed today” with an optional text summary and optional photos. Saving either is independent of attendance punching; an empty summary, no photo, or a failed upload cannot block checkout. Reports can be updated for the employee's current local work date, including after checking out.

Shift time is shown while the shift is open and frozen after checkout. Completed totals come from server-saved attendance timestamps; the live estimate uses server time plus a monotonic browser timer rather than the device's wall clock. Time is elapsed check-in to check-out, rounded down to complete minutes; breaks are not deducted because this portal does not record breaks. Same-minute checkout correctly shows `0h 0m`.

Photos use a private `attendance-photos` Supabase Storage bucket: JPEG/PNG/WebP, 5 MB per image, maximum five images per employee/day. Uploads go directly to Storage, not through a large Vercel request. A reserved slot is checked against the uploaded object's path, MIME type and size before it becomes a ready attachment. Preview links expire after five minutes; refresh the page to regenerate an expired preview. No photos are sent to CRM integrations or AI providers.

Storage and report access follow employee/team role policies. Owners can add their own photos; other employees cannot read or attach them. Authorized direct managers and administrators can read scoped records through the database policies. This is an internal evidence feature, not a public gallery or compulsory attendance selfie.

Interrupted uploads expose Finish upload and Discard controls. Discard first marks an unfinished slot, preventing a concurrent tab from publishing it during deletion. Published photos cannot be removed through the unfinished-upload interface. No employee photos were deleted during development; API tests used a generated one-pixel image and isolated accounts which were cleaned up.

Implementation uses two additive migrations (`20261012150000_daily_reports_and_photos` and `20261012151000_photo_discard_intent`) and keeps the existing punch function independent of report/photo functions. `dashboard_snapshot_v2` extends the old snapshot without breaking older callers.

Checks: 36 unit/rendered-interface tests, typecheck, lint and production build; `scripts/test-daily-report-db.mjs` verifies optionality, privacy, file constraints and checkout without notes/photos using rollback-only fixtures; `scripts/test-daily-photo-api.mjs` verifies actual private upload, metadata finalization, download/signed preview and denied unreserved/deletion operations using generated fixtures. Set `PHOTO_PORTAL_URL=http://localhost:3100` (or this project's Vercel origin) to also verify the authenticated rendered dashboard and shift total. No real employee accounts/passwords/attendance are changed by these scripts.
