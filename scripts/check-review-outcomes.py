"""Recalculate paired outcomes from the two execution receipts and the locked review."""
from pathlib import Path
from collections import Counter
import json
import subprocess

folder = Path("docs/experiments/2026-11-28-review")
def read(name):
    return json.loads((folder/(name + ".json")).read_text(encoding="utf-8-sig"))

design, pack, receipt, materials, review, result = map(read, [
    "design", "candidates", "score/receipt", "materials/receipt", "review", "summary"
])
archived = subprocess.check_output(["git","show",pack["commit"]+":"+folder.as_posix()+"/design.json"])
assert json.loads(archived) == design
accepted = set(review["acceptedBodyHashes"])
baseline = {}
for row in materials["rows"]:
    baseline[row["caseId"]] = (row["initial"]["status"] == "passed", row["originalHoldout"] == "passed")
counts = Counter()
seen = set()
by_case = Counter()
for job, candidate, row in zip(design["schedule"],pack["results"],receipt["rows"],strict=True):
    key = tuple(job[k] for k in ("caseId","group","repeat"))
    assert key not in seen
    seen.add(key)
    assert key == tuple(row[k] for k in ("caseId","group","repeat")) == tuple(candidate[k] for k in ("caseId","group","repeat"))
    cid,g,_ = key
    pub,hidden = baseline[cid]
    base = pub and hidden
    ok = row["status"] == "passed" and candidate.get("codeSha256") in accepted
    guarded = ok if row.get("publicStatus") == "passed" else base
    for name,flag in [("passed",ok),("fixed",ok and not base),("regressed",base and not ok),
                      ("guardPassed",guarded),("guardRegressed",base and not guarded),
                      ("onDemandPassed",base if pub else guarded),("onDemandCalls",not pub)]:
        counts[g,name] += int(flag)
    by_case[cid,g] += int(ok)
assert len(seen)==96
for (g,name),v in counts.items():assert v == result["arms"][g][name]
assert sum(a and b for a,b in baseline.values())==result["baseline"]["passed"]
for row in result["cases"]:
    for group in ("G","E"):assert by_case[row["id"],group]==row[group]
tokens=sum(c["usage"]["prompt_tokens"]*2+c["usage"]["completion_tokens"]*8 for c in pack["results"])
assert tokens/1e6==result["conservativeCNY"]
print("Matched locked requests, baseline, raw scores, repair/regression counts, public gates and conservative cost.")
