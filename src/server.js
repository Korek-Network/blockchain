import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KorekChain } from "./blockchain.js";
import { NETWORK } from "./config.js";
import { cryptoProvider } from "./crypto.js";

const chain = new KorekChain();
const root = fileURLToPath(new URL("../public/", import.meta.url));
const jobs = new Map();
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value));
};
const body = async (req) => { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks) || "{}"); };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, chain.status());
    if (req.method === "GET" && url.pathname === "/api/blocks") return json(res, 200, chain.chain.slice(-50).reverse());
    if (req.method === "GET" && url.pathname === "/api/transactions") return json(res, 200, chain.transactions());
    if (req.method === "GET" && url.pathname.startsWith("/api/transaction/")) {
      const transaction = chain.transaction(url.pathname.split("/").at(-1));
      return transaction ? json(res, 200, transaction) : json(res, 404, { error: "Transaction not found" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/block/")) {
      const block = chain.block(url.pathname.split("/").at(-1));
      return block ? json(res, 200, block) : json(res, 404, { error: "Block not found" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/balance/")) return json(res, 200, { address: url.pathname.split("/").at(-1), balance: chain.balance(url.pathname.split("/").at(-1)) });
    if (req.method === "POST" && url.pathname === "/api/wallet") {
      const wallet = cryptoProvider.createWallet();
      res.setHeader("cache-control", "no-store");
      return json(res, 201, wallet);
    }
    if (req.method === "POST" && url.pathname === "/api/transactions") {
      const transaction = chain.addTransaction(await body(req));
      chain.sealPending();
      return json(res, 201, chain.transaction(transaction.id));
    }
    if (req.method === "POST" && url.pathname === "/api/faucet") {
      const input = await body(req);
      return json(res, 201, chain.claimFaucet(input.address));
    }
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      const job = { id: crypto.randomUUID(), status: "queued", createdAt: Date.now(), ...(await body(req)) };
      jobs.set(job.id, job); return json(res, 201, job);
    }
    if (req.method === "GET" && url.pathname === "/api/jobs") return json(res, 200, [...jobs.values()]);
    if (req.method === "POST" && url.pathname === "/api/mine") {
      const input = await body(req); const queued = [...jobs.values()].find((j) => j.status === "queued");
      if (queued) { queued.status = "verified-prototype"; queued.miner = input.address; queued.completedAt = Date.now(); }
      return json(res, 201, chain.mine(input.address, queued ? { type: "ai-job", jobId: queued.id, score: 1 } : { type: "security-pow", score: 0 }));
    }
    if (req.method !== "GET") return json(res, 404, { error: "Not found" });
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) return json(res, 403, { error: "Forbidden" });
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".ico": "image/x-icon" };
    let contents;
    try { contents = await readFile(file); }
    catch (error) {
      if (error.code === "ENOENT") return json(res, 404, { error: "File not found" });
      throw error;
    }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }); res.end(contents);
  } catch (error) {
    if (res.headersSent) return res.end();
    json(res, 400, { error: error.message });
  }
});

server.listen(NETWORK.apiPort, () => console.log(`KOREK testnet running at http://localhost:${NETWORK.apiPort}`));
