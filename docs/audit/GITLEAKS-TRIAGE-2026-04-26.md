# Gitleaks Triage - 2026-04-26

## Scope

- Gate: `scripts/audit/run-gitleaks-gate.js`
- Failed audit run: `runtime/audit/20260426-enterprise-full-final/`
- Findings file: `runtime/audit/20260426-enterprise-full-final/gitleaks/gitleaks-git-history.json`
- Rule: `pem-private-key-content`

## Decision

The two history findings are verified false positives and are ignored by exact
Gitleaks fingerprints in `.gitleaksignore`.

## Evidence

Both findings point to `docs/REFACTORING_DEEP_PLAN.md` in historical commits:

- `92d6cd72d23b68c023010538cd5d3016fe872ee3`, line 208
- `645c1d5106f0d2afcae5be01ed6e9a4cecd0822e`, line 209

The flagged line is a documentation DoD that describes a fake test commit
containing a private-key header marker to prove that Gitleaks blocks it. It
contains no key body, no usable PEM material, and no production secret.

## Controls

- The source snapshot scan remains enabled.
- The full Git history scan remains enabled.
- The ignore entries are exact fingerprints, not path-wide allowlists.
- Any new private-key material in source or history remains blocking.

## Follow-Up

If this repository is mirrored into CI/CD with platform-specific Gitleaks
fingerprints, regenerate the fingerprints on that runner and keep the exception
scoped to the same two documented false positives.
