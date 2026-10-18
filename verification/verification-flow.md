# Independent source verification

The canonical build scripts use the exact Anchor 1.1.2 dependencies, original
Cargo.toml and Cargo.lock, Agave 4.3.0, platform-tools 1.58, SBPFv3 and release
opt-level `z`. No source changes or contract redeployment are required.

`scripts/build-canonical.sh` reproduces the original native compiler setup.
`scripts/build-otter-docker.sh` independently runs official `solana-verify`
0.5.2 in its digest-pinned Agave 4.3.0 image. That image initially contains
platform-tools 1.57; the explicit `--tools-version v1.58` argument is essential.
The trailing Cargo `--config 'profile.release.opt-level="z"'` reproduces the
original environment flag without changing Cargo.toml. The pinned CLI inserts
Cargo's separator and `--locked` itself. Both builds must produce the exact
210,168-byte ELF with SHA256
`534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3`.
The workflow also executes all 21 local LiteSVM tests against this exact binary.

## Explorer verification is a separate, signed metadata step

Publication of source and successful CI alone do not set an explorer badge.
The current Otter API requires build arguments in an on-chain Otter Verify PDA.
`POST /verify` only accepts `program_id` and optional `webhook_url`; legacy
`repository`, `commit_hash` and build fields are silently ignored.

The Otter Verify program allows any signer to create a separate verification
PDA for an executable program. It does not mutate that program. Its seeds are
`["otter_verify", uploader, program_id]`. For the original HEATWAVE administrator
`8AArjB93BF79WvxHhwHsXEqHjKBC41oNo5uCpjJa7bk1`, the PDA is
`CgpzNT1T4FpvMaHf19y39eopngsUhDFNdQJvw3hRXpDd`, bump 252.

The HEATWAVE program is immutable. Otter's API has a burned-authority recovery
path: it inspects the last ProgramData transaction and recovers its fee payer
when the transaction did not originate in Squads. A read-only check found that
the most recent ProgramData transaction is the finalized authority-removal
transaction `343dumdvkQnqjfs4ACJVhmqY8fsB9kXM8xG9ndVPhvFcaDerxUhmUtS7wpS15PeFBvMZv41994gmpBvA9oRbj5nR`,
slot 457217087, paid and signed by this original administrator. The administrator's
verification PDA did not yet exist at this observation. This provides a viable
metadata verification path, subject to the live API accepting and completing it.

After the exact public commit passes both builds, prepare the metadata from
`otter-metadata.template.json`, replace its commit and refresh ProgramData's
deployment slot. The administrator must approve the simulated metadata-only
transaction, paying its freshly quoted account rent and network fee. Never use
game backend keys or expose a keypair. Then submit:

```sh
solana-verify remote submit-job \
  --program-id Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k \
  --uploader 8AArjB93BF79WvxHhwHsXEqHjKBC41oNo5uCpjJa7bk1
```

The equivalent current API call is `POST /verify-with-signer` with the
`program_id` and `signer` above. It only works after that signer's PDA exists.
Record the job ID and check `/job/<id>` and `/status/<program_id>` until they
confirm success. Do not call a build verified before the live API confirms it.

## Primary references

- https://solana.com/docs/programs/verified-builds
- https://github.com/solana-foundation/solana-verifiable-build/tree/v0.5.2
- https://github.com/solana-foundation/solana-verifiable-build/blob/master/docker/v4.3.0.Dockerfile
- https://github.com/otter-sec/otter-verify/blob/main/programs/otter-verify/src/lib.rs
- https://github.com/otter-sec/solana-verified-programs-api/blob/master/src/api/handlers/async_verify.rs
- https://github.com/otter-sec/solana-verified-programs-api/blob/master/src/onchain/state.rs
- https://github.com/otter-sec/solana-verified-programs-api/blob/master/src/onchain/otter.rs
- https://github.com/otter-sec/solana-verified-programs-api/blob/master/src/build/mod.rs
