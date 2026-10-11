# State Mutation Consistency Contract

## Result and scope

Implemented a reusable, independently specified contract for six WebBackend mutation families. Persistence, event delivery, active projections, cold-client reads and mounted lifetime are separate assertions. Each family executes a local write, an external commit delivered through real sync, and a rejected write: 18 positive variants. Eleven controlled regressions verify that the harness detects failures instead of merely recording successful saves.

This is scoped coverage, not a claim that every Keyward mutation is tested. The independent matrix lives in `tests/state-contract/manifest.ts`; production selectors/subscriptions do not generate its consumer expectations. Twenty field requirements and thirteen persistent mutation operations are explicitly deferred. New surfaces within the inventory boundary must be classified; a deferred classification remains a visible gap.

## Actual mutation path and fixes

The web path is `WebWrites.update` → encrypted HTTP PUT → `WebBackend.sync` → catalog/item changes → `App` subscription → session/catalog/contribution reload → `Directory`/`Query` rebuild → `session-hold`/`PathStore.rebase` and versioned `Inspector.useDetail`. External tests commit directly in the independent server authority and then call the actual backend sync ingress. WebKit invokes the product Sync button. This proves sync delivery; it does not establish push delivery or native plugin ingress.

The contract found a real navigation defect: after a rename, the old slug was compiled against the new graph. Persistence, events, catalog and search could succeed while the open document became a search and its map remained stale. `PathStore.rebase` now carries semantic node IDs into the new graph, serializes current names, and updates history using the previous query before replacing it. Existing filter/home fallback semantics remain authoritative.

Ten navigation regressions cover item and parent rename, active filters, selected-node removal, independent related-item map anchor rename/removal, moves, literal search, repeated rebase and back/forward history. Restoring the old implementation is also a negative harness test through the real write path.

Other observed failures were fixed locally: duplicate map port keys during relation changes; missing SSH algorithm in web detail; and structured web errors losing their HTTP status in UI messages. Algorithm parsing was moved from the editor into a shared model helper. No event-system redesign was introduced.

## Executed matrix

Every row executes local write, external sync and refusal. Every successful variant independently checks authoritative persistence, the expected notification, fresh-client state and preserved reader DOM lifetime.

| Scenario | Dependent active projections | Additional value checks |
| --- | --- | --- |
| `item.name` | Document, catalog, search, breadcrumbs, map | Renamed identity remains selected |
| `login.username` | Document, catalog, search | Exact updated username |
| `item.notes` | Document | Clearing a secure note renders the empty state |
| `login.password` | Security, map | Password equality/reuse relation changes |
| `item.folder` | Document, catalog, breadcrumbs | Canonical destination and old-list removal |
| `ssh.material` | Document, catalog | Private/public material, fingerprint and algorithm checked separately |

The authority stores encrypted records and decrypts them using an independent Node crypto implementation. Cold reads use a newly created real backend and storage, not the live client's cache. Ed25519/RSA fixtures and SHA256 fingerprints are calculated independently. The harness mounts production `App` roots with real `WebBackend` and `WebWrites`; happy-dom shims supply geometry, fonts and leaving-row animation completion only.

Lifetime assertions retain both the reader window and actual non-ghost document DOM nodes. Waiting does not reopen views, navigate or emit changes. Refusal assertions require the expected structured HTTP 500 failure and unchanged canonical state. A WebKit save additionally requires a visible error. Console errors and page errors fail tests; expected rejection diagnostics are narrowly allowed only in the rejected browser scenario.

## Harness sensitivity: expected and observed

All eleven fault assertions passed. “Fails” below means the named contract verdict becomes false under the injected defect; the negative test itself passes only when that failure is observed.

| Controlled defect | Expected failure, observed by the test |
| --- | --- |
| Restore old slug-based rebase | Document/map fail while persistence, event, cold read and catalog pass |
| Acknowledge without commit | Persistence, cold read and document fail despite notification |
| Suppress events | Notification and document fail despite persistence/cold read |
| Disconnect App subscription | Document/catalog fail while independent observer receives the change |
| Return stale item detail | Document fails while catalog/search update |
| Return stale catalog | Catalog fails while persistence and notification pass |
| Emit wrong item ID | Notification fails even though global App reload updates the document |
| External commit without sync ingress | Notification/document fail while authority/cold client see the change |
| Remount readers | Values update but lifetime fails |
| Stale SSH fingerprint | Public key updates, fingerprint/document fail |
| Stale SSH algorithm | Public key updates, algorithm/document fail |

## Coverage guard and CI

`scripts/state-contract-coverage.mjs` uses the TypeScript AST to inventory direct `ItemDraft` members, `Writes` methods and editable `KIND_FIELDS` keys/parts, plus explicitly enumerated SSH material fields. It rejects missing declarations, invalid syntax and unsupported structural forms rather than silently omitting them. Seven tests cover the current boundary, additions of DTO/method/UI fields, invalid expectations and unsupported declarations/dynamic schemas.

This extractor is not a universal inventory of nested DTOs, Rust commands, arbitrary plugin payloads or every backend capability. Changes beyond its boundary need a corresponding inventory extension and independent requirements.

The execution ledger records `<scenario>:write/external/refusal` only after assertions pass. `KEYWARD_STATE_CONTRACT_COMPLETE=1` requires all eighteen records after the suite. Both CI and `npm run test:state` enable it. A deliberate filtered run with this flag failed and named seventeen missing variants, proving that registration alone is insufficient. Targeted development runs without the flag remain possible.

CI builds the GUI, runs core/web/GUI suites with completeness enabled, installs WebKit, runs four browser contracts, then retains existing Rust and smoke checks.

## Validation

| Check | Result |
| --- | --- |
| Core Vitest suite | 356 passed, including ten navigation regressions |
| Web Vitest suite with completeness enabled | 116 passed |
| GUI Vitest suite | 3 passed |
| Final `npm run test:state` | 36 passed: 29 consistency tests and 7 guard tests |
| `npm run test:state:webkit` | 4 passed: UI rename, external username sync, external SSH sync, rejected UI save |
| Deliberately incomplete run with completeness enabled | Expected rejection: seventeen missing executed variants |
| GUI, web and stand type checks/builds | Passed; Vite reports large bundle warnings |
| `git diff --check` | Passed |
| `cargo test --workspace --locked` | 598 passed, 3 ignored, 0 failed; exit 0 |
| CLI build and isolated `scripts/smoke.sh` | Passed: daemon, host selection, Ed25519/RSA signatures, foreign-host refusal and socket permissions |

One intermediate parallel frontend run reported React cleanup diagnostics in a refusal case. Isolated and complete repeats passed; the harness now wraps rejected updates and cold-client lock in async `act` so lifecycle waits are explicit. Errors remain asserted, not suppressed. The final contract run passed after this adjustment.

## Explicit remaining coverage

Twenty deferred field requirements: `ItemDraft.kind`, `orgId`, `collectionIds`, `favorite`, `reprompt`, `uris`, `tags`, native `sshKey`; `login.totp`; card `cardholderName`, `brand`, `number`, `expMonth`, `expYear`, `code`; identity `firstName`, `lastName`, `email`, `phone`, `company`.

Thirteen pending persistent operations: `create`, `regenerate`, `merge`, `createFolder`, `renameFolder`, `deleteFolder`, `createCollection`, `renameCollection`, `deleteCollection`, `invite`, `setMember`, `confirmMember`, `removeMember`. The classified `update` operation is exercised by the matrix. `verifyPassword`, `memberFingerprint` and `compareForMerge` are read-only; `generate` produces an ephemeral value whose persistence begins at a later write.

Native daemon persistence, actual SSH plugin/agent state, native held-key drafts, organizations and permissions, creation/merge/trash, autofill, settings, arbitrary plugin mutations and full card/identity projection matrices are not established by this work. Visual regressions are also not substituted for state assertions. Extend the matrix with actual consumers and real ingress paths for these surfaces; deferred entries do not count as passing coverage.

## Files Required for Review

Paths are repository-relative and exact. P0 files establish correctness; P1 files integrate the checks or contain narrow presentation fixes.

| Priority | File | Review purpose |
| --- | --- | --- |
| P0 | `ui/core/src/path/store.ts` | Semantic rebase and history preservation |
| P0 | `ui/core/src/path/rebase.test.ts` | Ten navigation regressions and existing fallback semantics |
| P0 | `tests/state-contract/manifest.ts` | Independent consumer matrix, explicit deferred fields/operations |
| P0 | `tests/state-contract/authority.mjs` | Independent encrypted authority, external commit, rejection and no-commit controls |
| P0 | `web/test/state-contract/harness.tsx` | Real backend/App integration, separate verdicts, cold reads and DOM lifetime |
| P0 | `web/test/state-contract/consistency.test.tsx` | Eighteen variants, eleven fault injections and executed ledger |
| P0 | `scripts/state-contract-coverage.mjs` | Fail-closed AST inventory and requirement audit |
| P0 | `web/test/state-contract/coverage.test.ts` | Guard boundaries and negative additions/schema tests |
| P0 | `tests/state-contract/browser.tsx` | Production App browser fixture and independent cold backend |
| P0 | `scripts/state-contract-webkit.mjs` | Real WebKit/UI actions, authority routing and browser failure checks |
| P1 | `ui/core/src/ui/MapSheet.tsx` | Deduplicated map ports and stable unique keys |
| P1 | `ui/core/src/model/ssh.ts` | Shared algorithm derivation |
| P1 | `ui/core/src/ui/SshKeyEdit.tsx` | Editor uses shared algorithm helper |
| P1 | `web/src/backend/catalog.ts` | Web SSH detail exposes algorithm |
| P1 | `ui/core/src/ui/fault.ts` | Preserve structured web error arguments |
| P1 | `ui/core/src/ui/fault.test.ts` | HTTP status regression assertion |
| P1 | `.github/workflows/ci.yml` | Mandatory completeness/frontend/WebKit checks |
| P1 | `package.json` | Contract and WebKit entry commands |
| P1 | `web/package.json`, `package-lock.json` | Declared happy-dom test dependency and lock consistency |
| P1 | `web/vitest.config.ts`, `web/tsconfig.json` | TSX contract collection and browser fixture type checking |
| Reference | `tests/state-contract/browser.html` | Test-only Vite browser entry |
| Reference | `tests/state-contract/authority.d.mts`, `scripts/state-contract-coverage.d.mts` | Type facades for test helpers |
| Reference | `docs/state-mutation-contract.md` | Scope, evidence, limitations and this review inventory |

## External review and delivery

Bidirectional review used the user-selected [Arc conversation](https://chatgpt.com/c/6aca3964-f200-83eb-a531-65518f2eff94). Its final verdict was “ACCEPT”, with G1 (fail-closed extraction) and G2 (mandatory executed assertions) both marked PASS and no blocking remarks. The reviewer received selected code, architecture and measured results, not an independently executed complete diff.

Changes are local and reviewable. This work does not create a new release or claim that the installed 0.2.2 binary includes these changes. Existing user UX specifications remain untouched.
