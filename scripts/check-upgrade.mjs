import { resolve } from 'node:path';
import { StateStore } from '../src/storage.js';
import { KorekChain } from '../src/blockchain.js';

// Only load(): never save, migrate, start a server, or connect to peers.
const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
  console.error('Usage: node scripts/check-upgrade.mjs /absolute/path/to/offline-backup');
  process.exit(2);
}
const report = {
  node: process.version,
  storageReadable: false,
  localLedgerValid: false,
  peerLedgerValid: false,
  deploymentApproved: false,
};
try {
  const state = await new StateStore(resolve(args[0])).load();
  if (!state) throw new Error('No saved state found; an empty directory is not a migration test');
  report.storageReadable = true;
  const bundled = state.bundleVersion !== undefined;
  const ledger = bundled ? state.chain : state;
  report.bundleVersion = bundled ? state.bundleVersion : null;
  if (bundled && state.bundleVersion !== 2) throw new Error('Unsupported bundle version');
  KorekChain.fromSnapshot(ledger);
  report.localLedgerValid = true;
  report.height = ledger.chain.length - 1;
  report.tip = ledger.chain.at(-1).hash;
  report.hasFaucetSupply = BigInt(ledger.testnetFaucetSupply || 0) !== 0n;
  report.hasFaucetClaims = (ledger.faucetClaims || []).length > 0;
  report.hasAuxiliaryState = bundled && Boolean(state.compute || state.validators);
  try {
    KorekChain.fromSnapshot(ledger, { peer: true });
    report.peerLedgerValid = true;
  } catch (error) {
    report.peerError = error.message;
  }
} catch (error) {
  report.error = error.message;
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.peerLedgerValid ? 0 : 1;
