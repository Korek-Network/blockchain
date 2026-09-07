import { cryptoProvider, addressFromPublicKey, sha256 } from "../../src/crypto.js";

export function summarize(values) {
  if (!values.length) return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  if (values.some(x => !Number.isFinite(x) || x < 0)) throw new Error("Invalid duration");
  const sorted = [...values].sort((a, b) => a - b), at = p => sorted[Math.ceil(p*sorted.length)-1];
  return { count: values.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: sorted.at(-1) };
}

export function wallet() {
  const result = cryptoProvider.createWallet();
  return { ...result, address: addressFromPublicKey(result.publicKey, "wormhole-v1") };
}

export function transfer(sender, recipient, timestamp, amount = "1") {
  const tx = { version: 3, from: sender.address, to: recipient, amount, timestamp,
    gasPrice: "1", gasLimit: "21000", addressScheme: "wormhole-v1", publicKey: sender.publicKey };
  if(process.env.KOREK_NETWORK_ID){tx.version=4;tx.networkId=process.env.KOREK_NETWORK_ID;}
  const message = (tx.version===4?`korek-transfer-v4|${tx.networkId}|`:"")+`${tx.from}|${tx.to}|${tx.amount}|${tx.timestamp}|1|21000|wormhole-v1`;
  tx.signature = cryptoProvider.sign(message, sender.privateKey);
  return { tx, id: sha256(message + tx.signature) };
}

export function commonPlacement(id, views) {
  if (!views.length) return null;
  const placements = views.map(view => view.get(id));
  if (placements.some(x => !x)) return null;
  const first = placements[0];
  if (placements.some(x => x.blockHash !== first.blockHash || x.height !== first.height)) return null;
  return { blockHash: first.blockHash, height: first.height, observedMs: Math.max(...placements.map(x => x.observedMs)) };
}

export function phaseMetrics(records, views, startedMs, finishedMs, offeredRate) {
  const accepted = records.filter(r => r.httpStatus === 201 && r.responseId === r.id);
  const rejected = records.filter(r => r.httpStatus !== null && r.httpStatus !== 201);
  const observed = accepted.map(r => ({ r, p: commonPlacement(r.id, views) })).filter(x => x.p);
  const ackEnd = accepted.length ? Math.max(...accepted.map(r => r.responseMs)) : null;
  const replicationEnd = observed.length ? Math.max(...observed.map(x => x.p.observedMs)) : null;
  const complete = observed.length === records.length;
  return {
    offeredRate, attempted: records.length, accepted: accepted.length, rejected: rejected.length,
    transportErrors: records.filter(r => r.httpStatus === null).length,
    replicatedOnAllNodes: observed.length, unreplicatedAccepted: accepted.length - observed.length,
    complete, elapsedThroughObservationMs: finishedMs - startedMs,
    localAcknowledgmentTps: ackEnd > startedMs ? accepted.length * 1000 / (ackEnd - startedMs) : null,
    completeBatchReplicationTps: complete && replicationEnd > startedMs ? records.length * 1000 / (replicationEnd - startedMs) : null,
    ackLatency: summarize(accepted.map(r => r.responseMs - r.sentMs)),
    allNodeObservationLatency: summarize(observed.map(({ r, p }) => p.observedMs - r.sentMs)),
    scheduleLateness: summarize(records.map(r => Math.max(0, r.sentMs-r.scheduledMs))),
    finalityTps: null, guaranteedFinalityMs: null,
  };
}
