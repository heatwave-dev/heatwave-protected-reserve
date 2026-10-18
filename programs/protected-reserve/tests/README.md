# Automatic reserve v0.2 runtime tests

These tests load the built SBF ELF into LiteSVM and execute the reserve program,
Token-2022, Associated Token Account and System Program instructions. They do not
replace contract execution with a JavaScript economic model.

On a supported Linux or macOS host:

```sh
cd programs/protected-reserve
cargo build-sbf --arch v3 --sbf-out-dir target/automatic-v2-deploy
cd tests
npm ci --ignore-scripts
HTW_RESERVE_SBF=../target/automatic-v2-deploy/heatwave_protected_reserve.so npm test
```

The command above explicitly tests the automatic v0.2 SBPFv3 build. The harness default is
`../target/automatic-v2-deploy/heatwave_protected_reserve.so`; always set
`HTW_RESERVE_SBF` to identify the intended binary. A missing or non-ELF artifact fails the
suite. Each run prints the artifact SHA-256 so results can be bound to the built
binary.

The pinned LiteSVM package publishes Linux/macOS native binaries; the npm runtime
does not support native Windows. This repository's application package and lockfile
are independent of this test package.

Each case creates an isolated SVM with signature verification enabled and fresh
in-memory test signers. A six-decimal mint fixture occupies the official HTW
address inside the disposable SVM. The fixture has revoked mint/freeze authority;
it is not a mainnet account mutation. Test funding is injected into a local source
token account, then the actual token program deposits into the reserve. Player
registration executes through the compiled program; the SVM Clock advances to test the seven-day gate.
Adversarial account-state fixtures are identified in their test cases.

Coverage includes exact 97%/3% token allocation and the separate SOL fee,
initialization consent, the configured game verifier signature, signature tampering,
holding before payout, registration age, expiration, replay, claim/daily/lifetime
caps, gross backing plus safety reserve, destination constraints, token extensions,
rejected administrator withdrawals, receipt pre-funding and full rollback when
the SOL transfer fails after both token transfers.

The automatic claim test executes with only the player and game backend signing.
There is no administrator or independent human reviewer in that transaction. The
contract trusts the backend's authorization of rewards: it does not prove gameplay
or prevent a compromised backend from authorizing false claims to an eligible
colluding player within the immutable limits. Removing a generic administrator
withdrawal instruction does not remove that trust or provide an absolute owner
non-withdrawal guarantee.

The previous dual-verifier profile is historical v0.1. Its private artifacts are
excluded from this repository. This suite targets the current automatic program
ID; public mainnet setup observations are recorded in
[the deployment evidence](../../../docs/public/reserve-evidence.json).

This suite makes no network requests, persists no signer keys and deploys no
program. Passing proves behavior of the tested binary in this local runtime; it
does not establish a qualified immutable deployment, correct backend reward
authorization, funded custody, backend integration or an external audit.
