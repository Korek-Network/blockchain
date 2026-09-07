// Public observations are projections, NOT mutations of canonical hash-covered
// transaction bytes. Legacy snapshots retain their original status encoding.
import { blockWork } from "./blockchain.js";

export function confirmationIndex(blocks) {
  const index = Array(blocks.length);
  let powConfirmations = 0, anchoredAt = null;
  for (let height = blocks.length-1; height >= 0; height--) {
    if (blockWork(blocks[height]) > 0n) { powConfirmations++; anchoredAt = blocks[height].timestamp; }
    index[height] = { status: height === 0 ? "genesis" : powConfirmations ? "anchored" : "included",
      powConfirmations, confirmations: powConfirmations, blockDepth: blocks.length-height,
      anchoredAt, finalized: false, finalityTimeMs: null, canReorganize: true };
  }
  return index;
}

export function transactionObservation(tx, index) {
  const included = Number.isSafeInteger(tx.blockHeight) && tx.blockHeight > 0 && Boolean(index[tx.blockHeight]);
  const observation = included ? index[tx.blockHeight] : { status: "pending", powConfirmations: 0,
    confirmations: 0, blockDepth: 0, anchoredAt: null, finalized: false, finalityTimeMs: null, canReorganize: true };
  return { ...tx, ...observation, observationVersion: 2,
    includedAt: included ? tx.confirmedAt : null,
    inclusionTimeMs: included ? tx.confirmationTimeMs : null,
    confirmedAt: observation.anchoredAt,
    confirmationTimeMs: observation.anchoredAt === null ? null : Math.max(0, observation.anchoredAt-tx.receivedAt) };
}

export function blockObservation(block, index) {
  return { ...block, ...index[block.height], observationVersion: 2,
    representation: "api-observation-not-canonical", canonicalPath: `/api/block/${block.hash}?format=canonical`,
    sizeBytes: Buffer.byteLength(JSON.stringify(block)),
    transactions: block.transactions.map(tx => transactionObservation(tx, index)) };
}
