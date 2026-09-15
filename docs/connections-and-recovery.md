# Connections, scheduled work, and recovery

These integrations are implemented and tested locally. The private Site is published, but the optional vault, scheduler and independent backup destination are not connected in this release. No external messages have been sent.

## Deployment settings

| Setting | Purpose |
|---|---|
| AUTOMATION_HMAC_SECRET | At least 32 characters of randomly generated signing material, shared only with the scheduler |
| AUTOMATION_ACTOR_EMAIL | Active staff account with Project Operations or Systems Admin authority; every generated action is attributed to this actor |
| VAULT_URL | HTTPS base endpoint of the organization's approved credential adapter |
| VAULT_TOKEN | Token authorizing the Site's requests to that vault |
| BACKUP_ENCRYPTION_KEY | Exactly 64 hexadecimal characters encoding a random 32-byte AES key |

Set these through protected hosting environment settings. Administration → Connections & recovery shows only whether each connection is configured. Example files contain blank values; no real keys or tokens are included.

## Scheduled policy and report workflows

The `workflows/` folder contains inactive n8n workflows for hourly policy checks and a Monday 08:00 Africa/Cairo weekly report. The workflows invoke `scripts/automation-runner.mjs` through Execute Command on a controlled self-hosted runner. The runner processes up to 30 bounded batches, signs each request and prints an operational result rather than a secret. Report output remains in the workflow execution; add an explicitly authorized destination separately.

Place the source at `/opt/depi` on the runner or edit the fixed command path. Configure runner variables:

- `DEPI_SITE_URL`: the successfully deployed HTTPS Site origin.
- `DEPI_AUTOMATION_SECRET`: the same signing material as AUTOMATION_HMAC_SECRET.
- `DEPI_SITE_ACCESS_TOKEN`: the authorized Sites dispatch token if the private hosting gateway requires it. App HMAC authentication does not bypass the hosting access policy.
- Optional `DEPI_EVENT_ID`: a stable prefix for a retry; do not invent a new event ID to work around an ambiguous prior result.
- Optional `DEPI_REPORT_FROM` and `DEPI_REPORT_TO`: fixed YYYY-MM-DD values when replaying a report request.

Request signatures cover timestamp, event ID and SHA-256 of the exact body. Requests older/newer than five minutes are rejected. Reused event IDs must have identical body hashes. Completed jobs return their stored result. Failed or stale jobs need a reasoned retry authorization in Administration before the same request is resubmitted. Committed policy batches are recognized from their immutable audit entry.

n8n's [Execute Command node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand/) runs on its host/container and is unavailable on n8n Cloud; current releases disable it by default. Deployment administrators must decide whether to enable it on a controlled runner. The same Node runner can be scheduled by the host's scheduler if this node is unavailable. n8n's [Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/) uses workflow/instance timezone and requires the workflow to be published. No host setting or workflow has been activated by this build.

## Credential access

Higher Board users can configure an account's vault reference, retrieve credentials for a documented purpose, and report exposure. The adapter contract is `GET {VAULT_URL}/{reference}` with bearer authorization, returning `{ "username": "...", "password": "..." }`. This is a generic adapter contract, not a claim of a native HashiCorp/AWS integration.

References accept a restricted path format. Retrieval is HTTPS-only, redirects are refused and requests time out. Every requested/granted access is audited without recording returned secret values. The UI hides returned values after 30 seconds; this is a display lifetime, not credential revocation. Exposure reporting blocks the account and creates an S1 case. The organization must rotate the exposed secret in its vault.

## Backup and recovery

An administrator downloads an encrypted ZIP containing a transaction-consistent database snapshot and separately encrypted immutable evidence objects. Each entry uses AES-256-GCM with a fresh IV and its entry name as authenticated data. The manifest records file hashes and table counts. An incomplete/missing object aborts the export. The encryption key is not included in the archive.

The interactive export limits a database snapshot to 16 MB and 20,000 rows per table; it streams evidence files. Larger production datasets need the provider's managed backup/export facilities. Move downloaded archives into the organization's independent backup destination. The app does not claim that storing another object in the same bucket protects against bucket loss.

Restore only into a new local directory:

`node scripts/restore/restore-backup.mjs /path/to/backup.zip /path/to/NEW-recovery-directory`

Provide BACKUP_ENCRYPTION_KEY in that process's protected environment. Run from the matching application source revision with dependencies installed and Node 22.13+. The tool refuses to overwrite an existing directory, verifies encrypted entries and evidence hashes, restores SQLite into that new directory, checks foreign keys/database integrity, and reinstalls integrity triggers. It never connects to the hosted database. Recovery output contains decrypted confidential data and must be stored accordingly.

The automated restore drill successfully restored the 1,000-student test fixture and its evidence file and verified that audit immutability remained enforced. This is local functional validation; production RPO/RTO, independent storage, retention and a hosted restore drill still require organizational configuration.
