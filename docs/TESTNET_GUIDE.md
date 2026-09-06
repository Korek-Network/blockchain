# KOREK local testnet guide

This guide runs one KOREK test node on your own computer. Version 0.1 is experimental: balances and blocks are held in memory and reset when the node stops.

## 1. Requirements

- Ubuntu or another modern Linux distribution
- Git
- Node.js 22 or newer
- npm

Check your installation:

```bash
git --version
node --version
npm --version
```

## 2. Download KOREK

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
```

If you already downloaded it, update it instead:

```bash
cd ~/blockchain
git pull
```

## 3. Test the software

```bash
npm test
```

All tests should report `pass` with zero failures.

## 4. Start the node

```bash
npm start
```

Leave this terminal open. The node and website use port `8365`. Open this address on the same computer:

```text
http://localhost:8365
```

## 5. Create a wallet

On the website, select **Create test wallet**. A JSON wallet file downloads to your browser's Downloads folder and its address is automatically placed in the mining box.

You can also create one from a second terminal:

```bash
cd ~/blockchain
npm run wallet
```

The file contains a private key. Keep it private, do not upload it to GitHub, and do not use it for real money. Losing the file means losing access to that test wallet.

## 6. Mine a test block

After creating a website wallet, select **Mine one test block**. The local node mines a prototype block and credits the displayed reward to that wallet address. The explorer refreshes automatically.

This version performs a small CPU proof-of-work demonstration. WebGPU detection is informational; real GPU AI workloads are a later development phase.

### Test the desktop wallet with faucet KRK

Start the local node and copy your wallet address. On the KOREK website, open **Testnet Faucet**, paste the address and select **Send 100 test KRK**. Each address can claim another 100 test KRK after one hour. Restarting the current in-memory node resets balances and faucet claim history.

## 7. Check the API

Open another terminal and run:

```bash
curl http://localhost:8365/api/status
curl http://localhost:8365/api/blocks
```

Replace the example below with your real address:

```bash
curl http://localhost:8365/api/balance/krk1YOUR_ADDRESS
```

## 8. Stop and restart

Press `Ctrl+C` in the node terminal to stop it. Start it again with:

```bash
cd ~/blockchain
npm start
```

Version 0.1 automatically confirms wallet transfers using rapid testnet finality, normally within milliseconds. Manual mining remains available for testing block rewards. The chain is not yet persistent, so restarting returns to the genesis block. Durable storage is planned for the next phase.

The current reward is 1.15740740 test KRK per manually mined reward block. Rapid transaction-confirmation blocks receive no new-coin reward and do not move the four-year halving counter. Faucet tokens are test-only and excluded from the 365 million mainnet allocation.

## Troubleshooting

- **`npm: command not found`:** install Node.js and npm, then confirm the versions.
- **Port 8365 already in use:** stop the earlier KOREK process, or run `KOREK_PORT=8366 npm start` and open port 8366.
- **Wallet button does nothing:** run `git pull`, restart `npm start`, then hard-refresh the browser with `Ctrl+Shift+R`.
- **Wallet download is blocked:** download it directly from [KOREK Wallet releases](https://github.com/Korek-Network/wallet/releases).
- **Node unavailable:** confirm the terminal running `npm start` is still open and has no error.
