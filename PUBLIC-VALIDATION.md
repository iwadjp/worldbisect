# Public validation record

This record is intentionally limited to public-safe facts. It does not include AIE paths, session metadata, temporary clone paths, raw environment values, or internal dogfood evidence.

## Real public issue

- Repository: `https://github.com/motdotla/dotenv`
- Issue: `https://github.com/motdotla/dotenv/issues/794`
- Pinned commit: `560df1555e7fb5cfe7254942e4dc54a16a3316f3` (v16.0.3)
- Same tracked source in GOOD and BAD.
- GOOD: explicit `USERNAME=something`.
- BAD: explicit `USERNAME=WINDOWS_ACCOUNT_FIXTURE`.
- Four unrelated environment variables differ.
- Candidates: 5.
- Predicate launches: 30, repeat 3.
- Observed 1-minimal set: `ENV:USERNAME`.
- Fresh candidate: FAIL; fresh removal: PASS.
- Residual differences: PASS, so `residualReproduces=false`.
- False success: 0.

This is a reproduction of a reported configuration collision using unmodified upstream source. It does not claim a newly discovered dotenv bug, root-cause proof, global minimum, unique causation, or human-time improvement.

## Environment hardening

The effective startup environment is probed before each predicate. A requested/effective mismatch returns INCONCLUSIVE, does not execute the predicate, and does not produce a cause. On Windows, Node/libuv can reintroduce some omitted variables, including `USERNAME`; custom SET/ABSENT/EMPTY behavior was tested separately. The public regression suite has 10 passing tests.

## Controlled checks

The prior controlled dogfood and integration validation remain the source prototype's evidence: 14 dogfood cases with expected PASS/INCONCLUSIVE outcomes and 8 integration checks. They are not presented as a real production incident. A small synthetic demo is included separately for onboarding.

## Scope decision

Current state: `PUBLIC_READY_WITH_HUMAN_GATE`. Remaining approval is the license choice and review of this standalone export. GitHub publication, package publication, and promotion are outside this record.
