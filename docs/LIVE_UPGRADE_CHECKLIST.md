# Live upgrade rehearsal

The experimental replay/SQLite branch is not yet approved for live deployment.
Start with a consistent offline backup. The checker does not start a node, connect
to peers, save state, or migrate storage. It reports aggregate compatibility and
the chain tip, without printing account balances or private keys.

## Collect evidence

Record the live code commit or binary version, runtime version, service command,
actual data directory, network settings and peer versions. Keep credentials out of
the report. Do not infer the data directory from a default: the service may override it.

At an agreed maintenance window, stop the writer and back up the complete data
directory, preserving permissions and all journal/database sidecar files. Verify
the backup before restarting the existing service. Alternatively use an established
consistent filesystem snapshot procedure. A recursive copy during writes is not a
verified backup. Preserve the original backup and inspect a separate copy.

On Node 24, from this repository, with the same consensus-related environment
settings as the live node, run:

```sh
node scripts/check-upgrade.mjs /absolute/path/to/offline-backup
```

Do not use the benchmark difficulty or reward interval for a live-state check.
Exit status 0 means ledger validation passed; 1 means incompatible/unreadable;
2 means incorrect usage. A pass is not deployment approval. Auxiliary compute and
validator state is flagged but is not validated by this ledger checker.

## Decide from the result

- Unreadable storage or invalid local history: preserve evidence and investigate.
  Never delete a journal or invent records to force startup.
- Local validation passes but peer validation fails: investigate the reported
  reason. Faucet-funded history needs a reviewed migration decision or a separate
  fresh testnet. Preserve the old chain and balances; do not strip faucet fields.
- Both pass: rehearse migration on a disposable copy in an isolated environment.

## Rehearse before scheduling deployment

Run the regression suite and security gate on the intended runtime. Start the
candidate only with an explicit disposable data directory, isolated ports and no
live seeds or public peer advertisement. Verify storage migration, exact balances
and tip, restart recovery, transfers and synchronization among isolated peers.
Review auxiliary state separately if present. Validate the actual release runtime;
the Bun standalone packaging is not yet established for this SQLite backend.

Rehearse rollback using the old executable and a separate full pre-upgrade backup.
Never downgrade in place over the SQLite marker. Once a new live node accepts
transactions, restoring an older backup can lose those transactions: the cutover
plan must define its acceptance window and recovery handling before deployment.

Schedule the live change only after compatibility, rehearsal and independent
security review are satisfactory. Coordinate all peers for protocol v4 and record
the exact candidate commit, backups, checks and rollback owner. Deployment remains
a separate action after these results are reviewed.
