# Round 15 reader-policy and reference audit

This is a development implementation, not a new package or contract release.
The released schemas, historical 291 payloads and pre-lane golden are unchanged.
FHT/FHGM retain their existing explicit V7 draft pins; no automatic refresh or
published/default support is introduced here.

## Runtime change and separate ledgers

D9/D10 on shared specification #211 select canonical standard checksums and the
YAML/gzip policies. Runtime R4 now checks checksum slots reached through the
selected contract, including metadata-only root and typed nested checksums.
Arbitrary extension values named checksum are not promoted to standard slots.
YAML directives and document-start markers refuse under R12, while identically
spelled text inside an indented block scalar remains data. Native zlib already
implements the selected gzip garbage/NUL/FHCRC policies; all actual byte and
stream paths are tested by the shared policy corpus.

The frozen old corpus contains noncanonical synthetic parent values. The dated
shared retirement crosswalk names exactly 78 affected preserved source payloads (69 are in the frozen 291) and their new
canonical counterparts. Old bytes and original expectations remain historical
records; the current test view checks their rejection, and separately executes
all 78 immutable counterparts with their actual intended predicates. It never
calls an old positive accepted under R4. The pre-lane default golden is preserved;
a separate 55-row D9 overlay names the exact predecessor/new fingerprints and
binds every change to that crosswalk. No unrelated default change is allowed.

The policy-view runner still accounts for all 291 historical IDs (228 supported
readings, 63 explicitly unsupported JSON-LD/HTML). That view is not the historical
228/0/63 validity ledger: 30 formerly valid noncanonical fixtures now reject.
The canonical counterparts and 64 supplementary policy cases are separate tests,
not additions silently folded into the old release ledger.

Current local native acceptance: 711 leaf tests, 648 passed, 63 declared unsupported
skips, zero failures and zero unexplained skips. Focused policy/counterpart suite:
143 passed, no skips. A packed candidate archive was extracted outside the checkout
with lockfile dependencies copied into its private tree; all 143 tests also passed
through that artifact's native runtime. This is an installed candidate receipt,
not npm publication. The supplemental comparison against the pinned historical
Python reader reports its exact expected D9 differences separately from unexpected
mismatches; it is not an equality claim or the native acceptance oracle.

## Declared-reference coverage

The new adapter reads the current native release, draft, suite, conformance and
example provenance records on every run. It reuses the shared immutable checker
at 6dee4c8baba723ec5cad825d521db2dbbc1921ae / SHA256
d64104ed33de344c18ba93c00575cad8b16024db5b95c34ee02556b6868f543c.
Bootstrap binds checkout HEAD, source/path, Git blob and digest, rejects symlinks,
and executes verified bytes from a private isolated Python snapshot. There is no
new audit engine and no automatic pin write.

Actual offline audit: 17 groups, 464 declared file-reference occurrences, all FRESH,
with confirmed missing-path controls. External owning suites are audited at their
manifest pins and remain external; their native fixture readers retain their own
pin enforcement. The added policy corpus is a deliberate selected-file projection,
with exact per-file source/local digests and an immutable last-change commit for
the complete selected closure. It is not a whole upstream conformance mirror.

Strict CI controls use independent temporary Git authorities, proving three
positive groups and 404 controls, changed-digest DRIFT, missing-tag-commit ABSENT
and missing-local ABSENT. Real advisory findings remain non-gating and scheduled;
setup/query failure emits QUERY_FAILED, never FRESH. Reports retain class and
coverage limits. Run:

```sh
python3 -m unittest discover -s tests -v
python3 scripts/check_reference_controls.py --checker-root /exact/checker/checkout
python3 scripts/audit_declared_references.py --checker-root /exact/checker/checkout
```

The Python audit is a separate job. Primary native acceptance still uses Node
alone. Historical and source receipts are under the coordinating workspace's
issue-review/round15a-20261119 directory; current PR CI supersedes progress counts.
