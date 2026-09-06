#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo "Node.js 22+ is required: https://nodejs.org"; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
major="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$major" -lt 22 ]; then echo "Node.js 22+ is required; found $(node --version)."; exit 1; fi
echo "KOREK Planck testnet miner setup"
echo "First create or restore your wormhole account."
npm run key
echo
read -r -p "Paste the 64-character Inner Hash shown above: " inner_hash
if [[ ! "$inner_hash" =~ ^[0-9a-fA-F]{64}$ ]]; then echo "Invalid inner hash."; exit 1; fi
echo "Starting the Planck node and miner. Press Ctrl+C to stop."
npm run mine -- --rewards-inner-hash "$inner_hash"
