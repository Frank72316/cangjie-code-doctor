"""Visualize unseen pass rates and the per-family R minus H contrast."""
from pathlib import Path
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

folder = Path("docs/experiments/2026-11-28-feedback")
s = json.loads((folder / "summary.json").read_text(encoding="utf8"))["panels"]
for font in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = font
        break
colors = ["#697b8a", "#388e8a", "#215578"]
fig, (left, right) = plt.subplots(1, 2, figsize=(11, 5.1), gridspec_kw={"width_ratios": [1.25,1]})
fig.suptitle("给出边界样例之后，实测结果还能多修对多少？", x=.04, y=.98, ha="left", fontweight="bold", fontsize=16)
for i, (group, name) in enumerate(zip("HSR", ["边界提醒","给出样例和期望","再给实测结果"])):
    vals = []
    for panel in ("linked","array"):
        a = s[panel]["arms"][group]
        vals.append(a["passed"]/a["runs"])
    positions = [base + (i-1)*.23 for base in (0,1)]
    left.barh(positions, vals, .18, label=name, color=colors[i])
    for y, val, panel in zip(positions, vals, ("linked","array")):
        a = s[panel]["arms"][group]
        left.text(val+.025, y, f'{a["passed"]}/{a["runs"]}', va="center", fontsize=9)
left.set_title("未展示的测试全部通过", loc="left", pad=12)
left.set(yticks=[0,1], yticklabels=["链表主样本","数组迁移题"], xlim=(0,1.24), ylim=(1.5,-.5),
         xticks=[0,.5,1], xticklabels=["0%","50%","100%"])
left.legend(loc="upper left", bbox_to_anchor=(-.08,-.15), ncol=3, frameon=False, fontsize=8)
families = {"seek":"条件查找","twin":"连续重复","alternating":"交替加减","paint":"修改奇数","invert":"负数变号","stamp":"条件插入"}
diffs = [s["linked"]["families"][family]["R"]-s["linked"]["families"][family]["H"] for family in families]
bound = max(2,max(abs(v) for v in diffs)+1.6)
right.axvline(0,color="#c1c9cc",lw=1,zorder=0)
for i, value in enumerate(diffs):
    right.barh(i, value, height=.52, color=colors[2] if value>=0 else "#a35245")
    right.text(value+(.14 if value>=0 else -.14), i, f'{value:+}' if value else '0',
               ha="left" if value>=0 else "right", va="center", fontsize=9)
right.set(yticks=range(len(diffs)), yticklabels=list(families.values()), ylim=(len(diffs)-.4,-.6),
          xlim=(min(-1,min(diffs)-1),bound), xticks=[])
right.set_title("实测组较提醒组多通过几次", loc="left", pad=12)
for ax in (left,right):
    ax.tick_params(length=0)
    for spine in ax.spines.values(): spine.set_visible(False)
fig.text(.04,.025,"同一题每种条件独立请求两次。主样本每个操作家族有 4 道题、每组 8 次机会。",fontsize=9,color="#53676e")
fig.subplots_adjust(left=.12,right=.97,top=.81,bottom=.23,wspace=.38)
fig.savefig(folder/"outcomes.png",dpi=160,facecolor="white")
