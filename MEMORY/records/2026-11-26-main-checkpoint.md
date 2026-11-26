# 2026-11-26 — Main checkpoint and history reconciliation

Owner requested merging to main and committing the current work. The active
branch was already `main`, at `5ca3556c`; application changes, tests, task boards,
specifications and their existing evidence records are included in this checkpoint.
Scratch `.tmp-*` files and `.agents/ck/` checkpoints remain local and untracked.

`git diff --cached --check` passed. No test suite was rerun for this Git operation;
the named results and limitations in the continuation-gates records still apply.
This checkpoint does not declare phase completion or authorize production actions.

After fetching, `origin/main` was `32cef46e`, with rewritten history diverging
from local main. Its tree equals the local checkpoint base `10f1fb33` exactly
(`85b6d9ebdeed019164bef1ab35f925bcfede19f7`); `git diff --exit-code` returned 0.
A merge-tree simulation identified conflicts in MEMORY/CHANGELOG.md,
MEMORY/MEMORY-INDEX.md, TASKS/PHASE-17-UPSTREAM-SECURITY-PRIVACY.md and
docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md. The intended reconciliation
preserves the checkpoint tree, incorporating remote ancestry without dropping
local additions. No push is included in the owner's request.
