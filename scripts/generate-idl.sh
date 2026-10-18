#!/usr/bin/env bash
set -euo pipefail
# Compiles an IDL from the unchanged deployed crate; never signs or sends a transaction.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
program_dir="${HTW_PROGRAM_DIR:-$repo_dir/programs/protected-reserve}"
output_file="${1:-$repo_dir/idl/heatwave_protected_reserve.json}"
anchor_bin="${ANCHOR_BIN:-anchor}"
if [[ "$($anchor_bin --version)" != "anchor-cli 1.1.2" ]]; then
  printf '%s\n' 'Anchor CLI 1.1.2 is required.' >&2
  exit 1
fi
scratch_dir="$(mktemp -d)"
trap 'rm -rf -- "$scratch_dir"' EXIT
mkdir -p "$scratch_dir/programs/protected-reserve" "$(dirname "$output_file")"
cp "$program_dir/Cargo.toml" "$program_dir/Cargo.lock" "$scratch_dir/programs/protected-reserve/"
cp -R "$program_dir/src" "$scratch_dir/programs/protected-reserve/"
cat > "$scratch_dir/Anchor.toml" <<'ANCHOR_CONFIG'
[features]
resolution = true
skip-lint = false
[programs.mainnet]
heatwave_protected_reserve = "Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k"
[provider]
cluster = "mainnet"
wallet = "/nonexistent/no-wallet-needed-for-idl-build.json"
ANCHOR_CONFIG
(
  cd "$scratch_dir"
  export NO_DNA=1
  "$anchor_bin" idl build --out "$output_file" -- --locked
)
node - "$output_file" <<'CHECK_IDL'
const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.argv[2];
const bytes = fs.readFileSync(file);
const idl = JSON.parse(bytes);
if (idl.address !== 'Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k') throw Error('Program mismatch');
const expected = ['initialize', 'register_player', 'claim'];
for (const instruction of expected) if (!idl.instructions.some(i => i.name === instruction)) throw Error(`Missing instruction: ${instruction}`);
const error = idl.errors.find(e => e.name === 'AccountTooNew');
if (error?.code !== 6007 || error?.msg !== 'First claim requires seven days of on-chain registration') throw Error('Seven-day error does not match source');
console.log(JSON.stringify({file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), instructions: idl.instructions.map(i => i.name), sevenDayError: error}, null, 2));
CHECK_IDL