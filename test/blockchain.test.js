import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { NETWORK, rewardAtHeight } from "../src/config.js";

test("genesis is deterministic and mining rewards a valid wallet", () => {
  const chain = new KorekChain(); const wallet = cryptoProvider.createWallet();
  const block = chain.mine(wallet.address);
  assert.equal(block.height, 1); assert.equal(chain.balance(wallet.address), block.reward);
  assert.equal(block.reward, "115740740"); assert.equal(block.rewardHeight, 0);
  assert.ok(block.hash.startsWith("0".repeat(NETWORK.difficulty)));
});

test("wallet address is derived from its public key", () => {
  const wallet = cryptoProvider.createWallet();
  assert.match(wallet.address, /^krk1[0-9a-f]{40}$/);
  const message = "korek-wallet-test";
  assert.ok(cryptoProvider.verify(message, cryptoProvider.sign(message, wallet.privateKey), wallet.publicKey));
});

test("faucet credits 100 test KRK once per hour", () => {
  const chain = new KorekChain(); const wallet = cryptoProvider.createWallet();
  const start = 2_000_000_000_000; const claim = chain.claimFaucet(wallet.address, 100n * 100_000_000n, start);
  assert.equal(claim.amount, "10000000000"); assert.equal(chain.balance(wallet.address), "10000000000");
  assert.throws(() => chain.claimFaucet(wallet.address, 100n * 100_000_000n, start + 59 * 60_000), /cooldown/);
  chain.claimFaucet(wallet.address, 100n * 100_000_000n, start + 60 * 60_000);
  assert.equal(chain.balance(wallet.address), "20000000000");
  assert.equal(chain.minedSupply, 0n); assert.equal(chain.testnetFaucetSupply, 20000000000n);
});

test("signed KRK transfer is accepted and settled", () => {
  const chain = new KorekChain(); const alice = cryptoProvider.createWallet(); const bob = cryptoProvider.createWallet();
  chain.mine(alice.address); const timestamp = Date.now(); const amount = "100000000";
  const message = `${alice.address}|${bob.address}|${amount}|${timestamp}`;
  chain.addTransaction({ from:alice.address,to:bob.address,amount,timestamp,publicKey:alice.publicKey,signature:cryptoProvider.sign(message,alice.privateKey) });
  chain.mine(alice.address); assert.equal(chain.balance(bob.address), amount);
});

test("version 2 transfer records gas, timings and explorer details", () => {
  const chain=new KorekChain();const alice=cryptoProvider.createWallet();const bob=cryptoProvider.createWallet();chain.claimFaucet(alice.address);
  const timestamp=2_000_000_000_000;const amount="100000000";const gasPrice="1";const gasLimit="21000";
  const message=`${alice.address}|${bob.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}`;
  const pending=chain.addTransaction({version:2,from:alice.address,to:bob.address,amount,timestamp,gasPrice,gasLimit,publicKey:alice.publicKey,signature:cryptoProvider.sign(message,alice.privateKey)},timestamp+100);
  assert.equal(pending.fee,"21000");assert.equal(chain.transaction(pending.id).status,"pending");
  const block=chain.mine(alice.address,undefined,timestamp+600);const confirmed=chain.transaction(pending.id);
  assert.equal(confirmed.status,"confirmed");assert.equal(confirmed.confirmationTimeMs,500);assert.equal(confirmed.confirmations,1);
  assert.equal(chain.block(block.hash).gasUsed,"21000");assert.equal(chain.balance(bob.address),amount);
});

test("rapid finality seals pending transfers without minting a reward", () => {
  const chain=new KorekChain();const alice=cryptoProvider.createWallet();const bob=cryptoProvider.createWallet();chain.claimFaucet(alice.address);
  const timestamp=2_000_000_000_000;const amount="100000000";const gasPrice="1";const gasLimit="21000";
  const message=`${alice.address}|${bob.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}`;
  const tx=chain.addTransaction({version:2,from:alice.address,to:bob.address,amount,timestamp,gasPrice,gasLimit,publicKey:alice.publicKey,signature:cryptoProvider.sign(message,alice.privateKey)},timestamp+1);
  const issuedBefore=chain.minedSupply;const rewardBlocksBefore=chain.rewardBlockCount;const block=chain.sealPending(timestamp+2);
  assert.equal(chain.transaction(tx.id).status,"confirmed");assert.equal(chain.transaction(tx.id).confirmationTimeMs,1);
  assert.equal(block.reward,"0");assert.equal(chain.minedSupply,issuedBefore);assert.equal(chain.rewardBlockCount,rewardBlocksBefore);assert.equal(block.usefulWork.type,"rapid-testnet-finality");
});

test("token allocations total 365M and mining halves every four years", () => {
  const allocations=NETWORK.miningAllocation+NETWORK.aiEcosystemAllocation+NETWORK.developmentAllocation+NETWORK.securityCommunityAllocation;
  assert.equal(allocations,NETWORK.maxSupply);assert.equal(rewardAtHeight(0),115740740n);
  assert.equal(rewardAtHeight(NETWORK.halvingInterval),57870370n);
  assert.equal(rewardAtHeight(NETWORK.halvingInterval*2),28935185n);
});
