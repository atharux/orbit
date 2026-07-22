# Data folder

`raw/` and `sanitized/` contents are **gitignored** — no Hydrat3 data (raw or
sanitized) is ever committed. This file documents the CSV shapes the pipeline
expects so you can drop exports into `raw/` and run `scripts/sanitize.py`.

## Expected files & columns

### venues.csv
`venue_id, name, category, district`
(plus optional `address` → collapsed to district by sanitize.py)

### contacts.csv
`contact_id, role, verified, venue_id, source`
- `verified` — `true`/`false`
- `source` — one of `Overpass`, `Foursquare`, `Yelp`, `Hunter.io`
- optional PII columns `email`, `phone`, `contact_name` are stripped/reduced
  by sanitize.py

### sequences.csv
`sequence_id, name, status`
- `status` — e.g. `active`, `paused`, `done`

### enrollments.csv
`contact_id, sequence_id`   (Contact ENROLLED_IN Sequence)

### sequence_targets.csv
`sequence_id, venue_id`     (Sequence TARGETS Venue)

## Sanitization

Any column not listed in `COLUMN_RULES` (scripts/sanitize.py) causes the script
to STOP rather than pass unknown data through. Add a rule before re-running.
