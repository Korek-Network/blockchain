#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo "Node.js 22+ is required: https://nodejs.org"; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
major="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$major" -lt 22 ]; then echo "Node.js 22+ is required; found $(node --version)."; exit 1; fi
echo "KOREK Planck testnet node and miner setup"
if [ ! -f node_key.p2p ]; then npm run node:key; else echo "Using existing node_key.p2p"; fi
echo "Create or restore your wormhole account."
npm run key
echo
read -r -p "Paste the 64-character Inner Hash shown above: " inner_hash
if [[ ! "$inner_hash" =~ ^[0-9a-fA-F]{64}$ ]]; then echo "Invalid inner hash."; exit 1; fi
read -r -p "Node name [my-korek-node]: " node_name
node_name="${node_name:-my-korek-node}"
echo "Starting the Planck node with its built-in prototype miner. Press Ctrl+C to stop."
npm run mine -- --name "$node_name" --validator --chain planck --node-key-file node_key.p2p --miner-listen-port 9833 --rewards-inner-hash "$inner_hash" --max-blocks-per-request 64 --sync full
