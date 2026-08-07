# Storage Orphan Cleanup

Scheduled Cloud Function that deletes unused (orphan) images from Firebase Storage under `exam-media/`.

## Config

| Key | Default | Description |
|-----|---------|-------------|
| `storage_cleanup.dry_run` | `"true"` | If `"false"`, actually delete orphan files. Otherwise only log. |

## Env config

```bash
# Dry run (default) — only log orphan candidates, do NOT delete
firebase functions:config:set storage_cleanup.dry_run="true"

# Switch OFF dry run — enable actual deletion
firebase functions:config:set storage_cleanup.dry_run="false"
```

View current config:

```bash
firebase functions:config:get storage_cleanup
```

## Deploy

```bash
cd functions
firebase deploy --only functions
```

Or deploy only this function:

```bash
firebase deploy --only functions:cleanupOrphanExamMedia
```

## How to switch DRY_RUN off

1. Run: `firebase functions:config:set storage_cleanup.dry_run="false"`
2. Redeploy: `firebase deploy --only functions:cleanupOrphanExamMedia`

**Important:** Start with `dry_run="true"`, verify logs, then switch to `"false"` when confident.

## Safety rules

- Runs every 24 hours (scheduled)
- Only touches files under `exam-media/`
- Skips files younger than 48 hours (grace period)
- Ignores YouTube and non-Storage URLs
- References: `questionImage`, `mediaUrl` (if firebasestorage), `options[].imageUrl`
