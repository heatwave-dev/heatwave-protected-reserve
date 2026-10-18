# Automatic HTW reserve, v0.2.1

Claims now require **player + game backend** signatures. No human reviewer is required. This supersedes v0.1, preserved in commit 6f577d2 and its separate evidence.

The program was published, initialized, made immutable and funded on Solana Mainnet on October 15, 2026. See the [public reserve reference](../../docs/public/reserve-and-transparency.md) for verified configuration and token-account addresses, transaction signatures and finalized slots. The initial deposit was 66,000,000 HTW; this is not a live balance. No independent security audit is claimed. Program ID: `Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k`, derived from the administrator, loader-v3 and seed `htw-auto-v0.2.0-20261015`. The seed remains fixed despite the crate patch version. Old configurations cannot be reused.

Publication and setup were separate, explicitly reviewed wallet operations. The public setup transactions are linked in [the deployment reference](../../docs/public/reserve-and-transparency.md#finalized-deployment-evidence); private operational tooling is excluded from this repository. Do not repeat initialization or funding just to run the game. The older administrator-controlled Squads treasury is separate from this protected reserve.

## Payments and authority

- Official Token-2022 mint: HKrTVBPVF9B8LEkNvZDm4PeNScnvoHv8JxNMTahVpump, six decimals.
- Fee wallet: 4Efsdp2PYBseESD4oqFfe2Sm4D9Tq6fbTVm4KztxiHVz, separate from the reserve.
- Minimum gross claim: 100,000 HTW. The player must already hold 2,500 HTW before payment.
- Player receives 97%; 3% goes to the fee wallet. Gross 100,000 HTW debits the reserve by 100,000 HTW.
- Claim studio fee: 2,500,000 lamports (0.0025 SOL) from player to fee wallet. Network fees and account rent are additional and must be freshly quoted.
- Transfers, receipts and counters commit atomically. Failed transactions can still incur network fees.

Only initialize, register_player and claim exist. There is no direct administrator withdrawal, update, delegation, recovery, close or arbitrary-CPI handler. Initialization requires creator and backend signatures; claims require player and configured backend signatures over the complete transaction. The reserve authority signs only fixed token-transfer paths.

**The backend remains trusted to validate gameplay earnings.** A compromised or dishonest backend can authorize fabricated claims to controlled player wallets subject to the on-chain checks. The deployed amount limits are u64::MAX, so they do not provide a lower commercial loss ceiling. Removing a direct withdrawal handler does not establish an absolute owner non-withdrawal guarantee. Distinct keys alone do not establish independent control. Losing the fixed backend key can permanently stop claims from an immutable instance; there is no replacement path.

The first claim requires seven days from actual on-chain registration. The contract checks expiry, nonreusable receipts, canonical official-token ATAs, supported extensions, pre-payout holding, gross backing plus safety reserve, and per-claim/player/global/lifetime limits. The official initialized configuration sets all four limits to u64::MAX and fixed safety retention to zero. These checks do not automatically account for every off-chain accrued liability.

## Accounts

| Account | Seeds | Bytes including discriminator |
| --- | --- | ---: |
| Config | htw_reserve, creator, 16-byte reserve ID | 154 |
| Authority | authority, config | No data account |
| Reserve | Canonical Token-2022 ATA of authority and mint | SPL layout |
| Player state | player, config, wallet | 113 |
| Claim receipt | claim, config, wallet, 32-byte claim ID | 137 |

Config stores creator, reserve ID, backend key, fixed caps and mutable counters. Daily counters use UTC days and reject clock regression. An arbitrary local instance is not an official reserve.

## Executed validation

Recorded deployment validation used pinned Anchor 1.1.2, Agave 4.3.0, Anza platform-tools 1.58; explicit **SBPFv3**. The recorded host check and **4/4 Rust tests passed**, as did **19/19 real LiteSVM runtime tests**, signatures verified, zero skipped. These are the historical deployment results, not a claim that an explorer verified build has completed. The automatic payout case requires only player and backend signatures and executes both token CPIs plus SOL. Other cases cover replay, substituted signers/accounts, insufficient holding/backing/SOL, timing, caps, unsupported extensions and rollback.

Recorded deployed optimized ELF: **210,168 bytes**, flags 3; SHA256 `534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3`. Optimization uses release `opt-level=z` with the existing fat LTO. Source SHA256: `8b8ff26c0c5671af2b2b1a29bc724e0f62a7a8a7f3841c9ed10e0b28b93253cc`. Public addresses and transaction observations are in [the public evidence](../../docs/public/reserve-evidence.json). Private operational artifacts and the baseline 249,992-byte candidate are excluded from this contract-only repository.

Superseded v0.2.0 used local ID `5w5aSyzkAmgYBcG3qop5EuLgpbMhAe7rnneuFkGjYKYc` and a 249,400-byte ELF with SHA256 `a35951ce489235a5ec97a6931282400a57ec664af8a5e30514fe4e628da8f82c`. Historical v0.1 and v0.2.0 private artifacts are excluded; neither identifies the current mainnet program. Current public observations are in [the deployment evidence](../../docs/public/reserve-evidence.json).

Build on a supported Linux host with isolated outputs and unchanged HOME:

~~~sh
NO_DNA=1 CARGO_TARGET_DIR=/path/to/isolated-target cargo test --locked
NO_DNA=1 CARGO_PROFILE_RELEASE_OPT_LEVEL=z cargo-build-sbf --manifest-path Cargo.toml --tools-version v1.58 --arch v3 --sbf-out-dir /path/to/isolated-artifacts -- --locked
cd tests
npm ci --ignore-scripts --no-audit --no-fund
HTW_RESERVE_SBF=/path/to/heatwave_protected_reserve.so npm test
~~~

Tests use ephemeral in-memory keys and an isolated SVM without RPC or wallet access. Missing artifacts/native dependencies fail. See [SBPFv3 migration guidance](https://github.com/anza-xyz/cargo-build-sbf#sbfpv3-migration); cluster feature status must be checked before deployment.

## Deployment versus game readiness

The public deployment evidence records the immutable program, initialized reserve and initial funding. Application readiness additionally depends on authoritative earning records, liability accounting, finalized payment reconciliation, the configured backend signing service and public hosting. A funded reserve does not prove that every real-player workflow has completed end to end.

Box and equipment purchases and the player Market are separate payment adapters. Their HTW destinations are the qualified reserve. The 500,000-lamport paid-box studio fee is not charged by this claim contract. The current official withdrawal path pays HTW, not an automatically converted fiat or stablecoin payout.

The operator cannot edit the fixed claim fee, holding minimum, signer or destinations through this program after initialization. No replacement-key or emergency recovery path exists. Read the [public trust boundaries](../../docs/public/reserve-and-transparency.md#trust-boundaries-and-operational-risks) before interpreting immutability as a safety guarantee.
