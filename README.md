# HEATWAVE protected reserve

Public source for the HEATWAVE HTW reserve program on **Solana Mainnet**.
This repository contains only the reserve contract, its isolated runtime tests,
and public deployment evidence. The game frontend, backend, player databases,
signing keys, RPC credentials and other application configuration are excluded.

| Item | Public reference |
| --- | --- |
| Program | [`Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k`](https://solscan.io/account/Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k) |
| Contract source | [`programs/protected-reserve/src/lib.rs`](programs/protected-reserve/src/lib.rs) |
| Dependency lockfile | [`programs/protected-reserve/Cargo.lock`](programs/protected-reserve/Cargo.lock) |
| Deployment evidence | [`docs/public/reserve-evidence.json`](docs/public/reserve-evidence.json) |
| Build and runtime tests | [`programs/protected-reserve/README.md`](programs/protected-reserve/README.md) |
| Generated IDL | [`idl/heatwave_protected_reserve.json`](idl/heatwave_protected_reserve.json) |
| Reproduction result | [`verification/reproducible-build-result.json`](verification/reproducible-build-result.json) |

## How to check the seven-day rule

In `src/lib.rs`, `FIRST_CLAIM_AGE_SECONDS` is exactly `7 * 86_400`, or
**604,800 seconds**. `register_player` saves `registered_at` from Solana's
on-chain clock. Before the first successful claim (`claim_count == 0`), `claim`
requires the on-chain time minus `registered_at` to meet that constant.

The corresponding `AccountTooNew` error is:

> First claim requires seven days of on-chain registration

The seven days begin when the registration transaction executes on Solana.
A browser timestamp, the date of a box purchase, or a backend database edit
does not alter that on-chain registration time. A successful claim additionally
needs the other checks in the contract: player and backend signatures, expiry,
minimum HTW holding, minimum claim size, backing, fixed destinations and limits.

See the [boundary runtime test](programs/protected-reserve/tests/reserve.runtime.test.mjs)
named `registered account cannot claim before seven days, including one second
before the boundary`. It executes the built program in an isolated LiteSVM;
it neither deploys nor transfers real funds.

## Source and executable verification

The source and lockfiles retain their original bytes. Source provenance and
SHA-256 hashes are recorded in [`source-manifest.json`](source-manifest.json).
The historical deployed ELF payload is recorded as 210,168 bytes with SHA-256:

```text
534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3
```

Publishing source, an IDL, or an expected hash is not by itself a verified build.
Only a successful reproducible build comparison against the deployed executable
can establish that association. On October 18, 2026, the original compiler setup
and the official `solana-verify` Docker image both reproduced the exact mainnet
payload. All 21 runtime tests passed. See the [build result](verification/reproducible-build-result.json),
[mainnet comparison](verification/reproduced-mainnet-comparison.json), and
[public workflow](https://github.com/heatwave-dev/heatwave-protected-reserve/actions/runs/39101086610).
Explorer registration is a separate signed metadata step; these results do not
claim that a live explorer badge has already been issued.

The deployed program uses Anchor 1.1.2, Agave 4.3.0, platform-tools v1.58,
SBPFv3, `opt-level=z`, fat LTO and the committed Cargo lockfile. These are the
recorded deployment settings; verification must reproduce the executable rather
than assume a different container toolchain produces the same bytes.

Some comments and the Cargo package description predate publication and still
refer to a local prototype. They are intentionally preserved to keep the exact
contract source bytes. The public addresses and dated deployment observations
are documented separately in [reserve transparency](docs/public/reserve-and-transparency.md).

## Trust and scope

The published program has no update or administrator withdrawal instruction.
The recorded upgrade authority is absent, and the program cannot be replaced
through that authority. The backend remains trusted to authorize gameplay
earnings; this repository does not claim an independent security audit or
guaranteed payout availability.

An IDL describes the public instruction/account/error interface. An IDL alone
does not prove the deployed binary, and its publication does not change the
program or remove the seven-day requirement.

## Reproduce the deployed program

On Linux x86-64, run `bash scripts/setup-linux-toolchain.sh` and then
`bash scripts/build-canonical.sh`. The compiler archives are hash-pinned and
the build rejects any executable that differs from the recorded mainnet payload.
With Docker installed, `bash scripts/build-otter-docker.sh` also reproduces the
program using the official `solana-verify` CLI and a digest-pinned build image.
These commands do not deploy or sign anything.

Use Node.js 24 to independently read the current immutable executable:

```sh
node scripts/check-mainnet.mjs verification-output/heatwave_protected_reserve.so
```

The optional file argument compares your rebuilt executable byte for byte with
finalized mainnet data. Omit it to inspect the published hash and immutability
only. A private RPC endpoint may be supplied through `SOLANA_READONLY_RPC`;
never commit an RPC credential. The public GitHub Actions build results are
available under this repository's Actions tab.

Generate the IDL from the unchanged crate with Anchor CLI 1.1.2:
`bash scripts/generate-idl.sh`. The generated file includes the seven-day error.
Its [generation result](verification/idl-generation-result.json) records the
compiler workflow and file hash. Generation checks that Anchor has not modified
the source or either Cargo file.
IDL generation neither changes the deployed contract nor publishes metadata
on-chain. Canonical IDL metadata was absent when the upgrade authority was
removed; any new on-chain IDL must therefore use explicitly non-canonical
metadata and identify its publishing authority.
