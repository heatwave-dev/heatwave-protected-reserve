#!/usr/bin/env bash
set -euo pipefail
task_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_tools=${HTW_BUILD_TOOLS:-"$task_repo/.build-tools"}
task_contract=${HTW_CONTRACT_DIR:-"$task_repo/programs/protected-reserve"}
if [ ! -f "$task_contract/Cargo.toml" ] && [ -f "$task_repo/Cargo.toml" ]; then task_contract=$task_repo; fi
task_output=${HTW_BUILD_OUTPUT:-"$task_repo/verification-output"}
mkdir -p "$task_output"
cd "$task_contract"
# The source and lockfile are byte-identical to the deployed candidate (LF).
printf '%s  %s\n' \
  8b8ff26c0c5671af2b2b1a29bc724e0f62a7a8a7f3841c9ed10e0b28b93253cc src/lib.rs \
  941841f6280f0c199757506b97ccf2d31b51c2912d42cd424ff677000ba47b2f Cargo.toml \
  cb721481623340e4e1a45e26fca7807e6d0583bda077c07afc81f1ed77d55aae Cargo.lock | sha256sum --check --strict
export NO_DNA=1 CARGO_BUILD_JOBS=2 CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_HOME="$task_tools/cargo-home"
export CARGO_TARGET_DIR="$task_repo/.build-target/sbf"
export PATH="$task_tools/platform-tools-v1.58/rust/bin:$task_tools/agave-v4.3.0/solana-release/bin:$PATH"
cargo-build-sbf --manifest-path Cargo.toml --tools-version v1.58 \
  --no-rustup-override --skip-tools-install --arch v3 \
  --sbf-out-dir "$task_output" --jobs 2 -- --locked 2>&1 | tee "$task_output/sbf-build.log"
"$task_tools/platform-tools-v1.58/llvm/bin/llvm-readelf" --file-header \
  "$task_output/heatwave_protected_reserve.so" | tee "$task_output/elf-header.txt"
printf '%s  %s\n' 534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3 \
  "$task_output/heatwave_protected_reserve.so" | sha256sum --check --strict
python3 - "$task_output/heatwave_protected_reserve.so" > "$task_output/binary-hashes.json" <<'PY'
import hashlib,json,struct,sys
p=sys.argv[1]
b=open(p,'rb').read()
assert b[:4]==b'\x7fELF'
assert struct.unpack_from('<I',b,48)[0]==3, 'Expected SBPFv3 e_flags=3'
assert len(b)==210168, 'Expected exact deployed ELF size'
print(json.dumps({'programId':'Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k','bytes':len(b),
 'elfSha256':hashlib.sha256(b).hexdigest(),
 'solanaVerifyTrimmedSha256':hashlib.sha256(b.rstrip(b'\0')).hexdigest(),
 'architecture':'SBPFv3','anchor':'1.1.2','agave':'4.3.0','platformTools':'1.58',
 'optLevel':'z','onChainPublicationPerformed':False},indent=2))
PY
cat "$task_output/binary-hashes.json"
