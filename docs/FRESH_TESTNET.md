# Fresh testnet and funded faucet

The owner approved starting fresh. This branch prepares the change; the live
server and its history have not been reset. Archive the complete old chain before
cutover. Old balances remain in that archive and are not copied into the new chain.

Use Node 24 and set `KOREK_NETWORK_ID=korek-planck-testnet-2` consistently on all
new nodes, with an explicit new data directory. This produces a distinct genesis
and peer network identity. The default remains testnet-1 for existing installations.
Use only new-network seeds. Wallet/miner configuration and release packaging still
need an end-to-end rehearsal before public launch.

The HTTP faucet no longer creates coins. Set `KOREK_FAUCET_KEY_FILE` to a protected
JSON file containing a dedicated Ed25519 `publicKey` and `privateKey` in PEM format.
Keep it outside the repository and public directory, with owner-only permissions.
Fund its wormhole-v1 address with verified mining rewards or ordinary transfers
from mined funds. No key is generated or deployed by this change.

Each request pays 1 test KRK. The rolling 24-hour budget is 1,000 KRK including
fees; each recipient has a 24-hour cooldown. Limits include pending transfers and
are reconstructed from selected chain history after restart. Use one faucet
writer per wallet: independent nodes cannot enforce a shared global budget.
Forks can reverse transfers and their history-based limits. Address rotation can
bypass per-address cooldowns, so the global budget bounds payouts; public ingress
still needs request-rate controls. This is not proof of unique-person eligibility.

Responses identify the transaction as included and explicitly not finalized.
An empty wallet rejects claims. The old direct-mint method remains only for
offline historical tests; it is no longer exposed through the HTTP faucet.

Version 4 transfer signatures include a protocol prefix and network identity.
Fresh networks reject versions 1–3 both on submission and when restoring history.
The legacy testnet-1 retains old transaction support. The faucet now signs v4.
The companion wallet branch signs v4 for testnet-2, and its miner rejects templates
for another network or wallet. Deploy the matching app; old apps are incompatible.
Use a dedicated faucet key and keep its private material out of shared backups.

This change improves faucet accounting, not measured TPS. Follow the live upgrade
rehearsal checklist, verify new wallet/miner compatibility and archive recovery,
then coordinate the public cutover. Do not launch by deleting the old data directory.
