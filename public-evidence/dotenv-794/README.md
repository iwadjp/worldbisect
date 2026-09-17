# dotenv #794 reproduction

This is a sanitized reproduction of the configuration collision described in [motdotla/dotenv issue #794](https://github.com/motdotla/dotenv/issues/794).

- Upstream repository: `https://github.com/motdotla/dotenv`
- Pinned commit: `560df1555e7fb5cfe7254942e4dc54a16a3316f3` (v16.0.3)
- No dotenv source is vendored here.
- No credentials or user-specific environment values are required.

The reproduction reads `lib/main.js` and `package.json` from a local checkout at that commit, then materializes the same tracked source into two disposable worlds. Both worlds contain `.env` with `USERNAME=something`. GOOD explicitly supplies that same value; BAD supplies `WINDOWS_ACCOUNT_FIXTURE`. Four harmless environment noise variables differ as well.

Run:

```powershell
git clone --depth 1 --branch v16.0.3 https://github.com/motdotla/dotenv.git .\dotenv-v16.0.3
node .\reproduce.cjs .\dotenv-v16.0.3
```

Expected result: PASS, five candidates, `ENV:USERNAME` as the observed 1-minimal set, 30 predicate launches, and `residualReproduces: false`. The predicate checks that dotenv loaded the fixture and then checks the effective `process.env.USERNAME`; a different load/content failure is not treated as the target failure.

This demonstrates a reported configuration collision. It does not prove an upstream defect, global minimum, unique cause, or human-time improvement.
