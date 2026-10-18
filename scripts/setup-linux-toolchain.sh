#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
task_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_tools=${HTW_BUILD_TOOLS:-"$task_repo/.build-tools"}
mkdir -p "$task_tools"

fetch_verified() {
  local asset=$1 url=$2 digest=$3 directory=$4
  if [ ! -f "$task_tools/$asset" ]; then
    curl --fail --location --retry 3 --output "$task_tools/$asset.part" "$url"
    mv "$task_tools/$asset.part" "$task_tools/$asset"
  fi
  printf '%s  %s\n' "$digest" "$task_tools/$asset" | sha256sum --check --strict
  if [ ! -f "$directory/.htw-extracted-$digest" ]; then
    if [ -d "$directory" ] && [ "$(find "$directory" -mindepth 1 -maxdepth 1 | wc -l)" != 0 ]; then
      printf 'Refusing to overwrite an existing tool directory: %s\n' "$directory" >&2
      exit 1
    fi
    mkdir -p "$directory"
    tar -xjf "$task_tools/$asset" -C "$directory"
    touch "$directory/.htw-extracted-$digest"
  fi
}

fetch_verified solana-release-x86_64-unknown-linux-gnu.tar.bz2 \
  https://github.com/anza-xyz/agave/releases/download/v4.3.0/solana-release-x86_64-unknown-linux-gnu.tar.bz2 \
  c97289a8abb1d0efb497d8b5cb285baabd9b7f8ea6647f5d145c5dc8ff3611e8 \
  "$task_tools/agave-v4.3.0"
fetch_verified platform-tools-linux-x86_64.tar.bz2 \
  https://github.com/anza-xyz/platform-tools/releases/download/v1.58/platform-tools-linux-x86_64.tar.bz2 \
  7b82eb420b5aebd1e5590db0ae25c523eca06724d4238ae02139690535636c37 \
  "$task_tools/platform-tools-v1.58"

# cargo-build-sbf 4.3.0 uses this upstream user-cache location. HOME is unchanged.
task_cache="${HOME:?}/.cache/solana/v1.58/platform-tools"
if [ -e "$task_cache" ] || [ -L "$task_cache" ]; then
  test "$(readlink -f "$task_cache")" = "$(readlink -f "$task_tools/platform-tools-v1.58")" || {
    printf 'Refusing to overwrite an existing platform-tools cache: %s\n' "$task_cache" >&2
    exit 1
  }
else
  mkdir -p "$(dirname "$task_cache")"
  ln -s "$(realpath "$task_tools/platform-tools-v1.58")" "$task_cache"
fi
"$task_tools/agave-v4.3.0/solana-release/bin/cargo-build-sbf" --version
"$task_tools/platform-tools-v1.58/rust/bin/rustc" --version
