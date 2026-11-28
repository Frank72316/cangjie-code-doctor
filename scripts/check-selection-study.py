"""Independently enumerate diagnoses, rerank pairs, and recount the two repair arms."""
from collections import Counter
from itertools import combinations, groupby
from pathlib import Path
import hashlib
import json
import subprocess
import sys


FOLDER = Path("docs/experiments/2026-11-28-selection")


def read(name):
    return json.loads((FOLDER / (name + ".json")).read_text(encoding="utf-8-sig"))


def spec(cid, array, t, mode):
    f, a, *rest = cid.split("_")
    b = rest[0] if rest else None
    q = list(array)
    if f in ("streak", "best"):
        inclusive = (mode == "inclusive") if f == "best" else ((a == "inclusive") != (mode == "comparison"))
        groups = groupby(range(len(q)), key=lambda i: q[i] >= t if inclusive else q[i] > t)
        runs = [list(indices) for active, indices in groups if active]
        if f == "streak":
            if mode == "count": v = sum(map(len, runs))
            elif mode == "tail": v = len(runs[-1]) if runs and runs[-1][-1] == len(q)-1 else 0
            elif mode == "firstRun": v = len(runs[0]) if runs else 0
            else: v = max(map(len, runs), default=0)
        elif runs:
            if (a == "right") != (mode == "tie"): runs.reverse()
            best = (min if mode == "short" else max)(runs, key=len)
            v = best[-1 if (b == "end") != (mode == "endpoint") else 0]
        else: v = -1
    elif f in ("quota", "index", "cap"):
        inclusive = (mode != "comparison") if f == "index" else mode in ("comparison","inclusive")
        hits = [i for i,x in enumerate(q) if (x >= t if inclusive else x > t)]
        if (a == "last") != (mode == "direction"): hits.reverse()
        if f == "quota":
            limit = 3-int(b) if mode == "limit" else int(b)
            selected = hits[:limit]
            v = len(selected) if mode == "count" else sum(q[i] for i in selected)
            for i in selected: q[i] = t
        else:
            v = hits[0] + int(mode=="oneBased") if hits else (0 if mode=="absentZero" else -1)
            if f == "cap":
                for i in hits if mode=="all" else hits[:1]: q[i] = t
    elif f == "cross":
        up = (b=="up") != (mode=="slope")
        def matches(x,y):
            if up: return (x <= t if mode=="inclusive" else x < t) and y > t
            return (x >= t if mode=="inclusive" else x > t) and y < t
        hits = [i for i,(x,y) in enumerate(zip(q,q[1:])) if matches(x,y)]
        v = (hits[-1 if (a=="last") != (mode=="direction") else 0] + int(mode=="rightIndex")) if hits else -1
    elif f == "window":
        marks = [i for i,x in enumerate(q) if x==t]
        selected = []
        if len(marks)>=2:
            lo,hi = marks[0], marks[1] if mode=="second" else marks[-1]
            inside = (a=="inside") != (mode=="scope")
            pos = (b=="pos") != (mode=="sign")
            for i,x in enumerate(q):
                if (lo<i<hi if inside else i<lo or i>hi) and ((x>0 if pos else x<0) or mode=="zero" and x==0):
                    selected.append(i)
        for i in selected: q[i]=0
        v=len(selected)
    else:
        assert f=="prefix"
        sequence=q[::-1] if mode=="reverse" else q
        inclusive=(a=="equal") != (mode=="comparison")
        end=next((i for i,x in enumerate(sequence) if (x>=t if inclusive else x>t)),len(q))
        v=end if mode=="count" else sum(sequence[:end+int(mode=="includeStop")])
    return (v,*q)


gate, pool, frozen = read("materials/receipt"), read("pool"), read("selection")
det, meta = read("detection"), read("starters")
pairs=list(combinations(range(len(pool)),2))
assert len(pairs)==276
candidate_spec_pairs=list(combinations(range(5),2))
for c,m,s,row in zip(det["cases"],gate["rows"],frozen,meta,strict=True):
    cid=c["id"]
    assert cid==m["caseId"]==s["id"]==row["id"]
    predictions=[[spec(cid,x["array"],x["t"],v) for v in s["variants"]] for x in pool]
    truth=[r[0] for r in predictions]
    assert [v for r in truth for v in r]==m["probe"]["reference"]["after"]
    obs=m["probe"]["starter"]["after"]
    fails=[tuple(obs[6*j:6*j+6])!=v for j,v in enumerate(truth)]
    assert sum(fails)==c["poolFailures"]
    assert sum(fails[i] or fails[j] for i,j in pairs)==c["detectingPairs"]
    for g in "UD": assert any(fails[j] for j in s[g])==c[g]
    def priority(pair):
        i,j=pair
        separated=[(a,b) for a,b in candidate_spec_pairs
                   if predictions[i][a]!=predictions[i][b] or predictions[j][a]!=predictions[j][b]]
        tie=hashlib.sha256(f"doctor-selection-tie-v1/{cid}/{i}/{j}".encode()).hexdigest()
        return -sum(a==0 for a,b in separated),-len(separated),tie
    assert tuple(s["D"])==min(pairs,key=priority)
    for counter in range(1000):
        draw=int(hashlib.sha256(f"doctor-uniform-v1/{cid}/{counter}".encode()).hexdigest()[:8],16)
        if draw<(2**32//len(pairs))*len(pairs):break
    assert tuple(s["U"])==pairs[draw%len(pairs)]
print("Independently reproduced both selection policies, SDK pool oracles and all 276 detection pairs per task.")
if "--materials" in sys.argv: sys.exit()

design,pack,receipt=read("design"),read("candidates"),read("score/receipt")
review,summary,traces=read("review"),read("summary"),read("traces")["rows"]
for commit,name,obj in [(pack["commit"],"design",design),(receipt["commit"],"candidates",pack),(receipt["commit"],"review",review)]:
    assert json.loads(subprocess.check_output(["git","show",commit+":"+FOLDER.as_posix()+"/"+name+".json"]))==obj
accepted=set(review["acceptedBodyHashes"])
tasks={r["id"]:r for r in det["cases"]}
counts=Counter()
money=Counter()
seen=set()
for job,c,r,tr in zip(design["schedule"],pack["results"],receipt["rows"],traces,strict=True):
    key=tuple(job[k] for k in ("caseId","repeat","group"))
    for record in (c,r,tr): assert key==tuple(record[k] for k in ("caseId","repeat","group"))
    assert key not in seen
    seen.add(key)
    cid,rep,g=key
    starter=tasks[cid];panel=starter["panel"]
    base=not(starter["publicFail"] or starter["hiddenFail"])
    trigger=starter["publicFail"] or starter[g]
    ok=c.get("codeSha256") in accepted
    passed=ok and r["status"]=="passed"
    sample=ok and tr["chosenPassed"]
    for k,v in {"runs":1,"passed":passed,"fixed":passed and not base,"regressed":base and not passed,
                "selectedPassed":sample,"sampleOnly":sample and not passed,"poolPassed":ok and tr["poolPassed"],
                "callsWhenTriggered":trigger,"passedWhenTriggered":passed if trigger else base}.items():
        counts[panel,g,k]+=int(v)
    u=c["usage"];cost_units=2*u["prompt_tokens"]+8*u["completion_tokens"]
    money[panel,g,"costCNY"]+=cost_units
    money[panel,g,"triggeredCostCNY"]+=cost_units*int(trigger)
for (p,g,k),v in counts.items(): assert summary["panels"][p][g][k]==v
for (p,g,k),v in money.items(): assert summary["panels"][p][g][k]==v/1e6
assert len(seen)==96
print("Independently recounted 96 model outcomes, guarded calls, regressions and costs.")
