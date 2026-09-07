// Both arguments must be locally validated KorekChain instances, never status
// advertisements. The server rechecks this decision against its CURRENT chain.
export function chainSelection(local, candidate) {
  if (candidate.chain[0]?.hash !== local.chain[0]?.hash) return { adopt: false, reason: "different-genesis" };
  const localWork = local.cumulativeWork(), candidateWork = candidate.cumulativeWork();
  if (candidateWork > localWork) return { adopt: true, reason: "stronger-work" };
  if (candidateWork < localWork) return { adopt: false, reason: "weaker-work" };
  if (candidate.chain.length <= local.chain.length) return { adopt: false, reason: "not-an-extension" };
  for (let i = 0; i < local.chain.length; i++) {
    if (local.chain[i].hash !== candidate.chain[i].hash) return { adopt: false, reason: "equal-work-fork" };
  }
  return { adopt: true, reason: "exact-extension" };
}
