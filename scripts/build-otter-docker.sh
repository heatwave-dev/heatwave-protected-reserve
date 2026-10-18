#!/usr/bin/env bash
set -euo pipefail
task_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_contract=${HTW_CONTRACT_DIR:-"$task_repo/programs/protected-reserve"}
if [ ! -f "$task_contract/Cargo.toml" ] && [ -f "$task_repo/Cargo.toml" ]; then task_contract=$task_repo; fi
task_output=${HTW_BUILD_OUTPUT:-"$task_repo/verification-output"}
task_tools=${HTW_BUILD_TOOLS:-"$task_repo/.build-tools"}
mkdir -p "$task_output" "$task_tools"
task_cli="$task_tools/solana-verify-0.5.2-linux"
if [ ! -f "$task_cli" ]; then
  curl --fail --location --retry 3 --output "$task_cli.part" \
    https://github.com/solana-foundation/solana-verifiable-build/releases/download/v0.5.2/solana-verify-0.5.2-linux
  mv "$task_cli.part" "$task_cli"
fi
printf '%s  %s\n' b9d5ccce9634dc14269cab3e7a58649bc141b3306e7735a94478c936341f211f \
  "$task_cli" | sha256sum --check --strict
chmod u+x "$task_cli"
"$task_cli" --version
# Official Agave 4.3.0 image pinned by digest, not a mutable tag.
task_image=solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd
NO_DNA=1 "$task_cli" build "$task_contract" \
  --base-image "$task_image" --library-name heatwave_protected_reserve \
  --arch v3 --cargo-build-sbf-args="--tools-version v1.58 --jobs 2" \
  -- --config 'profile.release.opt-level="z"' 2>&1 | tee "$task_output/solana-verify-build.log"
task_elf="$task_contract/target/deploy/heatwave_protected_reserve.so"
printf '%s  %s\n' 534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3 \
  "$task_elf" | sha256sum --check --strict
cmp "$task_elf" "$task_output/heatwave_protected_reserve.so"
cp "$task_elf" "$task_output/otter-docker-heatwave_protected_reserve.so"
"$task_cli" get-executable-hash "$task_elf" | tee "$task_output/solana-verify-executable-hash.txt"
# This script builds and hashes only. No wallet, PDA upload or transaction.
