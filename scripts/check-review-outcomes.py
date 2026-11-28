"""Recalculate the second-pass study using the archived input and execution receipts."""
from collections import Counter
from pathlib import Path
import json
import subprocess


folder = Path("docs/experiments/2026-11-28-review")


def read(name):
    return json.loads((folder / (name + ".json")).read_text(encoding="utf-8-sig"))


design = read("design")
pack = read("candidates")
receipt = read("score/receipt")
materials = read("materials/receipt")
review = read("review")
result = read("summary")
archived = subprocess.check_output(
    ["git", "show", pack["commit"] + ":" + folder.as_posix() + "/design.json"]
)
assert json.loads(archived) == design
accepted = set(review["acceptedBodyHashes"])

baseline = {}
for row in materials["rows"]:
    public = row["initial"]["status"] == "passed"
    hidden = row["originalHoldout"] == "passed"
    baseline[row["caseId"]] = (public, hidden)

case_meta = {c["id"]: c for c in design["cases"]}
counts = Counter()
by_case = Counter()
strata = Counter()
bodies = {}
for job, candidate, row in zip(design["schedule"], pack["results"], receipt["rows"], strict=True):
    key = tuple(job[k] for k in ("caseId", "group", "repeat"))
    assert key not in bodies
    for record in (row, candidate):
        assert key == tuple(record[k] for k in ("caseId", "group", "repeat"))

    cid, group, repeat = key
    public, hidden = baseline[cid]
    starter_passed = public and hidden
    body_hash = candidate.get("codeSha256")
    bodies[key] = body_hash
    passed = row["status"] == "passed" and body_hash in accepted
    guarded = passed if row.get("publicStatus") == "passed" else starter_passed
    unchanged = body_hash == case_meta[cid]["sourceHash"]
    outcomes = {
        "passed": passed,
        "fixed": passed and not starter_passed,
        "regressed": starter_passed and not passed,
        "guardPassed": guarded,
        "guardRegressed": starter_passed and not guarded,
        "onDemandPassed": starter_passed if public else guarded,
        "onDemandCalls": not public,
        "unchanged": unchanged,
    }
    for name, flag in outcomes.items():
        counts[group, name] += int(flag)
    by_case[cid, group] += int(passed)
    stratum = "passed" if starter_passed else ("hiddenOnlyFailure" if public else "publicFailure")
    for name, flag in {"n": True, "passed": passed, "unchanged": unchanged}.items():
        strata[group, stratum, name] += int(flag)

assert len(bodies) == 96 and len(baseline) == 24
for group in ("G", "E"):
    counts[group, "sameCodeAcrossRepeats"] = sum(
        bodies[cid, group, 1] is not None and bodies[cid, group, 1] == bodies[cid, group, 2]
        for cid in baseline
    )
for (group, name), value in counts.items():
    assert value == result["arms"][group][name]
for (group, stratum, name), value in strata.items():
    assert value == result["arms"][group]["byStarter"][stratum][name]
assert sum(p and h for p, h in baseline.values()) == result["baseline"]["passed"]
for row in result["cases"]:
    for group in ("G", "E"):
        assert by_case[row["id"], group] == row[group]

cost_units = sum(
    c["usage"]["prompt_tokens"] * 2 + c["usage"]["completion_tokens"] * 8
    for c in pack["results"]
)
assert cost_units / 1_000_000 == result["conservativeCNY"]
print("Verified paired scores, repairs/regressions, public selection, unchanged code and cost.")
