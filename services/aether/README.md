# Aether configuration and SQLite migration

## Configuration

All Aether runtime settings used by Chamy are read from
`Chamy/Aether.env`. This includes series round limits, tyre rules,
qualifying reductions, submission limits, leaderboard limits, feature flags,
and default role IDs. The file is parsed by `services/aether/config.js` and
does not depend on the process working directory.

The authoritative emoji catalog is `services/aether/teams.json`, copied from
the original Aether project. Team, series, and tyre emoji values are loaded
from that file at service startup; the original Aether directory is not
required at runtime.

The Discord bot token and Mongo connection secret are intentionally not
duplicated into `Aether.env`. Keep those secrets in the deployment secret
store or Chamy's private `.env`.

All privileged Aether tools, including session administration, profile
administration, sanctions, reductions, emoji setup, and leaderboard editing,
require a member of a configured `AETHER_START_ROLE_IDS` role. The service
performs this check against the live Discord member for every tool call.

## Proof submission

Drivers can reply to a message containing their screenshot/video proof and
ask Chamy to submit it. Chamy resolves the replying Discord user directly,
loads that user's active Aether profile, and uses Gemini vision to validate:

- a clearly visible `(T)` marker at the top of the lap timer;
- the best lap time from the second data row;
- the lap count for qualifying, sprint, practice, and training sessions.

Those session types reject lap counts above 12 (and unreadable counts);
race sessions have no lap-count limit. The extracted time, proof URLs,
marker, row, lap count, and OCR confidence are stored with the submission.
The `aether_submit` and `aether_submit_proof` chat tools use this same
validated path; manually supplied lap times cannot bypass proof validation.

Images are accepted by Discord MIME type or filename extension, including
PNG, JPEG, WebP, GIF, BMP, and AVIF. Video proof accepts MP4, MOV, WebM,
MKV, AVI, and M4V. This makes uploads robust when Discord reports
`application/octet-stream` or omits a MIME type. Proof downloads are checked
against `MAX_PROOF_FILE_SIZE_MB` before being sent to vision.

## MongoDB storage and retention

Chamy uses Mongoose for Aether persistence. In addition to the typed
collections (`AetherProfile`, `AetherSession`, `AetherSubmission`,
`AetherQualifyingResult`, and related models), Chamy maintains the
`aether_data` collection as the central guild-scoped Aether data/index store.
Profiles, sessions, submissions, qualifying results, and reduction settings
are mirrored there with stable entity keys.

When a session is completed, it receives `completedAt`. A retention worker
runs every 15 minutes and removes the completed session, its submissions,
session-scoped qualifying results, and central session-scoped cache records
after 72 hours. MongoDB's TTL index also removes central records whose
`expiresAt` has passed. Guild-wide default reduction settings are retained;
only data associated with the expired session is removed.

The migration is one-shot and non-destructive. It reads the source SQLite
database and imports profiles, license keys, sessions, submissions, penalties,
and qualifying results into the selected Chamy guild.

```sh
node services/aether/migrate.js \
  --sqlite ../Aether/Aether-main/data.db \
  --guild-id 123456789012345678 \
  --dry-run

MONGO_URI="$MONGO_URI" node services/aether/migrate.js --apply \
  --sqlite ../Aether/Aether-main/data.db \
  --guild-id 123456789012345678
```

Read-only mode is the default and prints source counts without connecting to
Mongo. Add `--apply` to perform the import. Imports are
idempotent: source integer IDs are stored as `legacyId` and writes use
`(guildId, legacyId)` keys. Existing Mongo documents are not overwritten or
deleted. SQLite proof paths are retained as legacy metadata; new submissions
use Discord URLs and proof metadata.

The SQLite profile tables do not contain a guild ID, so `--guild-id` is
mandatory. Legacy `penalties` are retained in `AetherLegacyPenalty` and are
also represented as completed Chamy sanctions with `LEGxxxxx` codes.
