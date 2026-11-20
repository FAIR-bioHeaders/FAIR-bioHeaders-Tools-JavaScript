# Round 16B maintenance — JavaScript, 2026-11-20

Refs FAIR-bioHeaders/FAIR-bioHeaders-Specification#211. Base `bac1781`.
Continues the earlier policy commit `5542637` and its unfinished README edit.
No schema, vector, golden, draft bytes or provenance pin is changed.

## Documentation and fixes

Added installed-package setup/API/error/resource guidance and a runnable valid,
checksum and mutated-body rejection example. It passes both from the source tree
and a tarball installed into an isolated consumer directory on Node 24.22.1.
The four language packages are source installs, not registry publication claims.
Current shared FHT/native FHGM publication is distinguished from this consumer's
historical owning-draft pins; no default support or automatic repin is introduced.

A workflow scan found six informational shell-template interpolation findings in
draft pin outputs. They originate from tracked provenance, not a privileged
pull_request_target context, but interpolation into shell source is avoidable.
Pin outputs now enter quoted environment variables; actionlint and workflow
regressions pass and zizmor reports zero findings. This does not change pins.
Stripping documentation now explicitly distinguishes structural stripping from
contract/checksum validation and warns that output may replace an existing file.

## Bounded security checks

- `npm audit --json`: locked graph, zero reported advisories, 2026-11-20.
- `gitleaks git --log-opts=--all --redact=100 --report-format json`: Gitleaks
  8.30.1, 56 commits/2,461,922 bytes, 43 matches. Each retained fingerprint was
  inspected: public fixture accession/SeqCol/checksum identifiers and public
  provenance file digests. None was a credential; no broad ignore was added.
- `zizmor --format json .github/workflows`: zizmor 1.16.3, six informational
  template findings before the fix, zero after.
- `actionlint -color=false`: actionlint 1.7.12, passed after the fix.
- `node scripts/check-vendoring.mjs`: 316 digests match; matrix/docs checks pass.

These scans are not security certification. npm audit is advisory/database scoped;
no claim of formal parser verification or hostile-workload isolation is made.
There is no configured dedicated JavaScript SAST engine beyond workflow analysis;
a separate independent general runtime review covers all `src/*.js`, workflow
files, package manifest, SECURITY and setup guide. Its exact scope, limitations,
findings and source-verified dispositions are posted on the PR.

## General review limits and dispositions

Configured `nrp/qwen3` reviewed supplied first-party runtime source read-only.
No execution was attributed to that review. Confirmed limits: failed Readings may
lose earlier diagnostic detail on selection failure and use placeholder fields;
callers must require `valid` rather than treating missing checksum errors as a
pass. This is disclosed, not changed by rewriting the historical default golden.
Streaming total bytes/time and FHGM feature-index growth remain caller-bounded.

Source verification rejected several proposed defects: quoted overflow-shaped
strings are accepted (the overflow check is plain-style gated); normative D10
explicitly forbids document-start markers, not an automatic document-end ban;
checksum path checks walk schema-declared properties rather than arbitrary
extensions; missing-file errors really can throw; exclusive temp-file creation
is outside the removal catch, so a pre-existing file is not removed. On-disk
provenance is a packaging trust root, not protection against tampering with the
whole installed package. Pinning its hash in another mutable file would not add
a security boundary. No speculative schema additions or blanket rejects added.

## Cleanup and handoff

Existing branches/worktrees, including unknown/active/review work, are retained.
Only this reserved branch is edited. No unsafe force cleanup, release or merge
is performed. The final PR records exact head, model review, applicable hosted
checks and remaining limits. Native acceptance remains the existing accounted
suite; draft evidence is separate and unsupported formats stay NOT_RUN.
