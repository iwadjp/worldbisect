# Worldbisect

Worldbisect takes two worlds at the same Git commit and searches the explicitly captured differences between them. It can combine environment variables, untracked or ignored files, and small cache files in one fresh-execution workflow.

The result is an **observed 1-minimal** set that reproduces a selected failure under the supplied predicate. It is scoped to the captured differences and that predicate. It does not prove root cause, global minimum, unique causation, or that the failure occurs in every environment.

## Why

`git diff` can show no source change while two developer machines behave differently. The difference may be an environment variable, a local configuration file, or a stale cache. Worldbisect makes those differences explicit, replays selected subsets in disposable directories, and stops when the predicate becomes ambiguous.

The practical contribution is workflow packaging: same-commit verification, mixed Git-external world atoms, fresh replay, failure-identity checks, and conservative reporting. Delta debugging itself is established prior art.

## Quick start

Worldbisect is a dependency-free Node CLI. It does not install packages, create commits, or mutate the input repositories.

```powershell
node .\worldbisect.cjs snapshot --repo D:\work\app-A --out D:\temp\world-A --env .\env-A.json --include .env.local --include .cache --include node_modules/.cache
node .\worldbisect.cjs snapshot --repo D:\work\app-B --out D:\temp\world-B --env .\env-B.json --include .env.local --include .cache --include node_modules/.cache
node .\worldbisect.cjs run --a D:\temp\world-A --b D:\temp\world-B --out D:\temp\world-result.json --repeat 3 -- node predicate.cjs
```

The two snapshots must have the same commit and identical selected tracked source. Snapshot output and reports must be new paths outside the input repositories.

## GOOD and BAD worlds

World A is the repeatedly passing baseline. World B is the repeatedly failing world. A run must identify both before minimization begins. The command is an argv array after `--`; use an explicit shell command when the application requires one.

The predicate should identify the particular failure, for example by writing `WORLDBISECT:FAIL:stable-id` and exiting 1. Exit 0 is PASS. A crash, timeout, spawn error, unexpected nonzero exit, excess output, unstable repeat, or different failure identity is INCONCLUSIVE.

## Capture

`--env` contains only relevant explicit variables. A string requests SET, `""` requests EMPTY, and `null` requests ABSENT. Worldbisect captures the requested values, not a complete machine environment. Declare every relevant variable in one or both maps.

`--include` adds Git-external files or small directory roots. Untracked files, ignored files, and `node_modules/.cache` entries are supported. The whole `node_modules` tree, symlinks and junctions, special files, unsafe paths, and file/directory topology conflicts are rejected. A snapshot is limited to 512 files and 32 MiB.

## Windows environment semantics

Requested and effective environments are separate concepts. Before every predicate trial, a temporary child process observes the effective startup state of every variable declared in either snapshot. Values are compared by state and SHA-256 without retaining raw values in the report.

On Windows, Node/libuv may supplement some omitted variables from the parent process. In the tested Node v24.15.0/libuv 1.51.0 runtime, `USERNAME`, `USERPROFILE`, `SYSTEMROOT`, `PATH`, and `TEMP` could be reintroduced; a custom variable and `TMP` were absent when omitted. `USERNAME` therefore cannot reliably represent an effective absence request on that runtime. HOME, user-profile, application-data, and temp paths are owned by Worldbisect and are reserved.

If requested and effective state differ, the trial is INCONCLUSIVE, `predicateExecuted` is false, and no cause or failure identity is returned. This check covers the Node/libuv launch boundary; it does not observe changes made later by a shell, preload, or application. Trusted `NODE_OPTIONS` preloads may run during the probe and must be treated as part of the predicate's trust boundary.

## Minimization and evidence

Worldbisect applies ddmin-style chunks and complements. Each repetition materializes fresh ordinary file copies under an owned OS temporary directory. Final checks replay the candidate in forward and reverse materialization order, remove each candidate item, and recheck A and B.

`minimalCause` means:

- observed 1-minimal: removing any reported item made the target predicate PASS in the fresh checks;
- only among the captured differences and within the supplied predicate;
- not a global cardinality minimum, unique cause, or causal proof.

`residualReproduces: true` means that differences outside the reported set also reproduced the target failure. Reports include candidate identities, requested/effective environment checks, failure identity, execution hashes, and counts. They do not include raw predicate output.

## Real-world validation

The public evidence reproduces [motdotla/dotenv issue #794](https://github.com/motdotla/dotenv/issues/794) at pinned commit `560df1555e7fb5cfe7254942e4dc54a16a3316f3` (v16.0.3). The unmodified dotenv implementation is exercised with the same `.env` value in both worlds. GOOD supplies `USERNAME=something`; BAD supplies a different explicit inherited value. Four unrelated environment variables are also changed.

The result was five candidates, 30 predicate launches, `ENV:USERNAME` as the observed 1-minimal set, a fresh FAIL with the cause, a fresh PASS after removing it, and no false success. This reproduces the reported configuration collision; it does not claim to have discovered a dotenv bug or to measure human time saved. See `public-evidence/dotenv-794/` for the sanitized reproduction materials.

## Synthetic demo

`demo/synthetic-demo.cjs` uses a tiny real Node predicate with one relevant environment difference, one irrelevant environment difference, an unused local file, and a harmless cache file. It demonstrates the workflow without pretending to be a production incident:

```powershell
node .\demo\synthetic-demo.cjs
```

## Limitations and privacy

This is filesystem-copy isolation for trusted local predicates, not an OS security sandbox. Absolute paths, network access, services, registry state, ACLs, timestamps, empty directories, large dependency trees, detached daemons, and arbitrary external writes are outside the model. There is no automatic full-environment discovery or dependency installation.

Environment values and included file contents are stored in snapshots, so treat snapshot directories as sensitive. Do not capture credentials or publish raw internal evidence. The public evidence here uses synthetic fixture values and points to the upstream repository and commit instead of vendoring third-party source.

## Development status

The scratch prototype has passed its controlled dogfood, integration validation, Windows environment regression tests, and one public issue reproduction. Current status is **Public v0.1.0** — the initial public release, validated on the Windows/Node.js scope described above.

Useful local checks:

```powershell
node --test .\env.test.cjs
node .\demo\synthetic-demo.cjs
node .\worldbisect.cjs --help
```

Closest concepts include [git bisect](https://git-scm.com/docs/git-bisect), [delta debugging](https://www.cs.purdue.edu/homes/xyzhang/fall07/Papers/delta-debugging.pdf), [Zeller's environment-variable example](https://www.st.cs.uni-saarland.de/edu/adebug/2002/04-simplifying.pdf), and [Halfempty](https://github.com/googleprojectzero/halfempty). Direct competitor absence is unproven.

## Related tools

This project is part of a small set of tools for investigating AI-coding and
debugging problems that Git alone cannot explain.

- [Timewitness](https://github.com/iwadjp/timewitness) — check whether a regression test fails before a fix and passes after it.
- [wipwho](https://github.com/iwadjp/wipwho) — split mixed uncommitted Claude/Codex changes into request-level patches.
- [Ember](https://github.com/iwadjp/ember) — recover source retained by a still-running Node.js process.
- [Worldbisect](https://github.com/iwadjp/worldbisect) — reduce same-commit environment differences to an observed 1-minimal reproducing set.
- [Afterimage](https://github.com/iwadjp/afterimage) — inspect retained NTFS USN history after an agent run.

[Overview and articles](https://blog2020.iwadjp.com/2026/09/18/ai-coding-debugging-tools-portfolio/)

**Article:** [Git diffはcleanなのにNode.jsが失敗する。同じcommitの環境差分を絞り込むWorldbisect](https://blog2020.iwadjp.com/2026/09/18/worldbisect-reduce-same-commit-environment-differences/)
