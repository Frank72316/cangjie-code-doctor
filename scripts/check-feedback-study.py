"""Recount the paired experiment using public receipts, independent of the JS summary."""
from collections import Counter
from pathlib import Path
import json
import subprocess


folder = Path("docs/experiments/2026-11-28-feedback")


def read(name):
    return json.loads((folder / (name + ".json")).read_text(encoding="utf-8-sig"))


def committed(commit, name):
    data = subprocess.check_output(["git", "show", f"{commit}:{folder.as_posix()}/{name}.json"])
    return json.loads(data)


design, pack, score = (read(n) for n in ("design", "candidates", "score/receipt"))
materials, review, result = (read(n) for n in ("materials/receipt", "review", "summary"))
traces = read("holdout-traces")["rows"]
assert committed(pack["commit"], "design") == design
assert committed(score["commit"], "candidates") == pack
assert committed(score["commit"], "review") == review
assert committed(materials["commit"], "probes") == read("probes")
accepted = set(review["acceptedBodyHashes"])
starters = {r["caseId"]: r for r in materials["rows"]}
meta = {r["id"]: r for r in design["cases"]}
total = Counter()
counts = Counter()
by_case = Counter()
by_family = Counter()
billing = Counter()
unique = set()
policy = Counter()
observed = Counter()
for task in design["cases"]:
    body = {g: json.loads(r["messages"][1]["content"]) for g, r in task["requests"].items()}
    assert body["R"].pop("observed") == starters[task["id"]]["probe"]["starter"]
    assert body["R"] == body["S"]
    sample = body["S"].pop("example")
    assert {"status": "passed", **sample["expected"]} == starters[task["id"]]["probe"]["reference"]
    assert body["S"] == body["H"]
for job, response, row, trace in zip(design["schedule"], pack["results"], score["rows"], traces, strict=True):
    key = tuple(job[f] for f in ("caseId", "group", "repeat"))
    for record in (response, row, trace):
        assert key == tuple(record[f] for f in ("caseId", "group", "repeat"))
    assert key not in unique
    unique.add(key)
    task, group, _ = key
    family, panel = meta[task]["family"], meta[task]["panel"]
    m = starters[task]
    before = m["initial"]["status"] == "passed" and m["originalHoldout"] == "passed"
    valid = response.get("codeSha256") in accepted
    public = row.get("publicStatus") == "passed"
    probe = public and valid and row.get("probeStatus") == "passed"
    passed = row["status"] == "passed" and valid
    for name, flag in {
        "runs": True, "passed": passed, "publicPassed": public, "probePassed": probe,
        "probeOnly": probe and not passed, "unseenOnly": passed and not probe,
        "otherShapePassed": trace["otherShapePassed"], "fixed": passed and not before,
        "regressed": before and not passed, "unchanged": response.get("codeSha256") == meta[task]["sourceHash"]
    }.items():
        counts[panel, group, name] += int(flag)
    initial_probe = m["probe"]["starter"]
    level = "passed" if initial_probe["status"] == "passed" else ("mismatch" if "returned" in initial_probe else "unavailable")
    observed[panel, level, group] += int(passed)
    if group == "R":
        public_fail = m["initial"]["status"] != "passed"
        for mode, call in {"public": public_fail, "publicOrProbe": public_fail or level != "passed", "always": True}.items():
            policy[panel, mode, "calls"] += int(call)
            policy[panel, mode, "passed"] += int(passed if call else before)
            policy[panel, mode, "costCNY"] += response["costCNY"] if call else 0
    by_case[task, group] += int(passed)
    by_family[panel, family, group] += int(passed)
    total[panel, group] += int(passed)
    for name, source in (("input","prompt_tokens"), ("cached","prompt_cache_hit_tokens"), ("output","completion_tokens")):
        billing[name] += response["usage"][source]

assert len(unique) == 192 and len(starters) == 32
for (panel, group, name), value in counts.items():
    assert result["panels"][panel]["arms"][group][name] == value
for (task, group), value in by_case.items():
    assert result["cases"][task][group] == value
for (panel, family, group), value in by_family.items():
    p = result["panels"][panel]
    assert p["families"][family][group] == value
    assert p["leaveOneFamilyOut"][family] == (
        total[panel,"R"] - total[panel,"H"] - by_family[panel,family,"R"] + by_family[panel,family,"H"]
    )
for (panel, level, g), value in observed.items():
    assert result["panels"][panel]["byObservation"][level][g] == value
for (panel, mode, name), value in policy.items():
    assert result["panels"][panel]["policies"][mode][name] == round(value, 6)
assert billing == result["tokens"]
assert (2 * billing["input"] + 8 * billing["output"]) / 1e6 == result["conservativeCNY"]
print("Reproduced all three treatments, 192 verdicts, paired family effects, regressions and costs.")
