# HODLXXI Bitcoin Contract Verifier V1 — Development / Review Only

Status: **Draft PR, not production-certified.** This tool reuses the public
`wasm-bitcoin-tools` v86_64 guest and unmodified, offline Bitcoin Core.
Only the browser page may make an **explicitly user-triggered** call to
`mempool.space` (Esplora); Bitcoin Core itself has no network device.

## Public examples (no private keys)

The test vectors at `tests/fixtures/public-contract-vectors.json` are
reproducible from the publicly disclosed HODLXXI project:

- **Human, legacy_777:** two mirrored `cltv_only` P2WSH witness scripts;
  the two heights on each leg differ by **777 blocks**. Exact script bytes and
  mainnet witness-script hashes are sourced from
  [the project unit test](https://github.com/hodlxxi/Universal-Bitcoin-Identity-Layer/blob/main/tests/unit/test_mirrored_covenant_pair.py).
  The public bootstrap manifest historically records precise funding outpoints,
  but these must not be presented as **currently** unspent without a fresh
  blockchain query.
- **Operator ↔ agent, current_144:** an outer `OP_IF` branch contains
  `2 <agent> <operator> 2 OP_CHECKMULTISIG`. The outer `OP_ELSE`
  contains an inner `OP_IF / OP_ELSE` with unilateral CLTV exits at
  **1,777,777** (agent) and **1,777,921** (operator), respectively.
  Source: [the public covenant artifact](https://github.com/hodlxxi/Universal-Bitcoin-Identity-Layer/blob/main/app/data/trust/covenant_hodlxxi-herald-covenant-v1.json).
  Its published status is **unfunded_declared**, not a funding proof.

The precise CRT profile distinction is documented in
[CRT Covenant Profile V1](https://github.com/hodlxxi/Universal-Bitcoin-Identity-Layer/blob/main/docs/CRT_COVENANT_PROFILE_V1.md).
**Do not quietly rewrite the historical human 777-block legs as 144-block
legs.** The 144-block profile shown in this snapshot is for operator-agent
continuity and does not confer human membership or authorization.

## Trust and verification layers

1. **Input acceptance:** use *public* witnessScript hex, a `raw(HEX)` script
   descriptor optionally with checksum, or an ordinary Bitcoin Core output
   descriptor. The page is not designed to handle wallet files or private keys.
2. **Offline Core decode:** `decodescript` decodes the script and builds a
   P2WSH witness output, or `getdescriptorinfo` parses a descriptor.
   A `raw(HEX)` *output* descriptor describes a raw scriptPubKey in Core;
   **we additionally interpret its embedded bytes as a candidate witnessScript**
   for this HODLXXI inspector. This is not identical to `wsh(raw(...))`,
   which is **not a valid output-descriptor form**.
   For `raw(HEX)#checksum`, the full input (including checksum) is submitted
   to Core's `getdescriptorinfo` first; the extracted HEX then goes to
   `decodescript`.
3. **Two-branch semantic inspection:** an exact, conservative byte-level
   template recognizer identifies the two supported structures above.
   Unrecognized scripts can still be decoded, but must not be labeled
   HODLXXI-conformant. Even a recognized template does **not** prove the
   pubkeys are controlled by participants, signatures exist, the transaction
   will be spendable, or full CRT membership conditions are met.
4. **Derivation:** the browser hashes raw script bytes independently with
   SHA256 and compares `0020<hash>` to the output returned by Bitcoin Core's
   `decodescript.segwit.hex`. It displays the corresponding address.
5. **Optional external UTXO/history lookup:** only pressing **Check address
   on mempool.space** sends the public address to that third party via an
   Esplora-compatible API. It reports current UTXOs, confirmation status,
   and at most 25 recent transactions returned by that API. The result is
   **not independent Bitcoin consensus proof**, and the outside service
   can observe the caller's IP and requested public address. The guest itself
   has no network adapter. A local full node remains the higher-assurance
   source of UTXO state.

For P2WSH, CLTV does not automatically guarantee future spendability;
Script execution depends on branch choice, signatures, nLockTime type/value,
input nSequence and Bitcoin consensus validity at broadcast time.

## Recorded external funding snapshot (not a consensus proof)

On **2026-10-21 03:13:37 UTC**, a read-only GitHub Actions runner queried
**mempool.space** and **Blockstream.info** directly for the three public
P2WSH contract addresses. Both API sources returned matching balance totals
and exact confirmed outpoint collections for the human mirrored pair:

| Public contract | Current confirmed UTXOs reported | Confirmed unspent balance |
| --- | ---: | ---: |
| Human legacy_777 leg A (`bc1qqkkh…`) | 3 | **300,000 sats (0.003 BTC)** |
| Human legacy_777 leg B (`bc1qrj4k…`) | 2 | **300,000 sats (0.003 BTC)** |
| Operator–agent current_144 (`bc1qsrpj…`) | 0 | **0 sats** |

Detailed confirmed outpoints reported for leg A:
`133129 + 44648 + 122223 = 300000 sats`.
For leg B:
`177777 + 122223 = 300000 sats`.

This **300,000 satoshi amount must not be confused with 300 satoshis**.
Each human address had a matching on-chain `chain_stats` balance of
300,000 sats with no unconfirmed UTXOs in these snapshots.
The agent address had no transaction history reported at the time.

[GitHub Actions read-only probe and full logs](https://github.com/hodlxxi/wasm-bitcoin-tools/actions/runs/39537388596).

These are time-bound external API reports, **not proof that amounts remain
unspent at a later time** and not full-node consensus verification.
Script→hash→address linkage was separately verified using the public
witnessScript bytes. No HODLXXI server, wallets, credentials, or private keys
were used.

## Automated tests

`node --test tests/contract-verifier.test.mjs` runs without a node, wallet,
Internet connection, or private keys:

- Validated fixture parsing for both human legs and the operator-agent leg.
- Independent SHA256 of the exact witnessScript bytes, known hashes, and
  test-side BIP173 address encoding against published mainnet addresses.
- Input rejection of secrets and malformed/altered templates.
- Browser JavaScript syntax check and presence of offline guest controls.

The workflow `.github/workflows/contract-verifier-tests.yml` runs those
tests on the PR. **Passing this unit suite is not equivalent to browser
integration or Core RPC testing.**

## Required browser acceptance checks before merging

1. Build the complete site with the upstream `scripts/setup.sh` flow on
   supported x86_64 Linux, with Bitcoin Core integrity checks enabled.
2. Open the fourth tool and load each public example; confirm actual guest
   boot, Core RPC return, decoded ASM, exact P2WSH hashes and published
   addresses (especially `bc1qsrpjjn3w8ly8da7u59y7ywzly4he7lfnl8462qrxp3d368gexess3tjdz3`
   for the agent declaration).
3. Confirm the `raw(HEX)#checksum` path validates the checksum and then
   decodes the witnessScript (not mistakenly using raw output-descriptor
   derivation as the P2WSH address).
4. Confirm corrupt inputs, secret-bearing descriptors, wrong network and
   Core startup errors fail visibly and do not enable funding lookups.
5. Confirm browser network requests are **not made** until a human explicitly
   requests UTXO lookup. Check CORS, API errors, timeouts, stale responses,
   confirmed vs unconfirmed classifications, and no-address cases.
6. Reconcile results against a trusted full Bitcoin node. Avoid claiming
   that historical public bootstrap outpoints are currently unspent based
   solely on fixture data.
7. Security review (DOM injection, shell interpolation, guest frame
   spoofing, large input, resource limits, privacy) and regression testing
   of the original three tools.

**Deployment boundary:** draft PR only; don't merge to `master` or publish a
production verifier until these checks pass.
