# Environment Readiness Matrix

| Environment | Readiness | Description | Required Checks | Notes |
|---|---|---|---|---|
| linux | PARTIAL | Node + Rust + desktop core gates | `00,01,02,04,05,06,11,22` | 05:ESLint gate => ✖ 9 problems (8 errors, 1 warning) \\|   0 errors and 1 warning potentially fixable with the `--fix` option. \\| [2026-04-22T20:11:49.996Z] exit=1 signal=none timedOut=false |
| windows | BLOCKED | Desktop + E2E + release dry-run readiness | `00,01,02,04,05,08,11,12,20` | missing checks: 08, 12 \\|\\| 05:ESLint gate => ✖ 9 problems (8 errors, 1 warning) \\|   0 errors and 1 warning potentially fixable with the `--fix` option. \\| [2026-04-22T20:11:49.996Z] exit=1 signal=none timedOut=false |
| php-enabled | PARTIAL | License server syntax and runtime checks | `03,18` | 03:PHP version => 'php' is not recognized as an internal or external command, \\| operable program or batch file. \\| [2026-04-22T20:11:30.066Z] exit=1 signal=none timedOut=false \\|\\| 18:License-server PHP lint => [php-lint] php runtime is unavailable in PATH \\| [php-lint] spawnSync php ENOENT \\| [2026-04-22T20:14:17.055Z] exit=127 signal=none timedOut=false |
| website | READY | Website toolchain and production build | `21,19` | all required checks passed |
