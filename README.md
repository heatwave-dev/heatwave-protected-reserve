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
can establish that association. See this repository's verification results for
the actual outcome; this initial source export does not claim an explorer badge.

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
