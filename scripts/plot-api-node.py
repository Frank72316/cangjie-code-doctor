"""Show the four document conditions and the four pairs of cursor tasks."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

folder = Path("docs/experiments/2026-11-28-node")
data = json.loads((folder / "summary.json").read_text(encoding="utf-8"))
for font in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = font
        break

groups = ["L", "N", "O", "B"]
labels = ["仅链表清单", "加节点声明", "加可空值示例", "两者都加"]
pairs = ["neighbor", "weighted", "update", "insert"]
fig, (bars, matrix) = plt.subplots(1, 2, figsize=(11, 4.6), gridspec_kw={"width_ratios":[1.08,1]})
fig.suptitle("补充哪份文档，能帮模型修好链表游标程序？", x=.045, y=.975, ha="left", fontsize=18, weight="bold")
for i, g in enumerate(groups):
    passed = data["byGroup"][g]["statuses"].get("passed",0)
    bars.barh(i, 16, color="#ecf0f1", height=.54)
    bars.barh(i, passed, color="#28776a" if g=="B" else "#5d7f96", height=.54)
    bars.text(16.35, i, f"{passed}/16", va="center")
bars.set(yticks=range(4), yticklabels=labels, xticks=[], xlim=(0,19.3), ylim=(3.6,-.6))
bars.set_title("全部 8 道题，每组每题做两次", loc="left", fontsize=12, pad=19)
values = [[data["byPair"][p][g] for g in groups] for p in pairs]
matrix.imshow(values, vmin=0, vmax=5, cmap="Blues", aspect="auto", interpolation="nearest")
for j in range(4):
    for i in range(4):
        v=values[j][i]
        matrix.text(i,j,f"{v}/4",ha="center",va="center",color="white" if v>=3 else "#153146",weight="bold")
matrix.set(xticks=range(4), xticklabels=["仅清单","加节点","加示例","都加"], yticks=range(4), yticklabels=["读取邻项","加权读取","修改邻项","隔项插入"])
matrix.xaxis.tick_top()
matrix.set_title("分别看四对任务",loc="left",fontsize=12,pad=12)
for ax in (bars,matrix):
    ax.tick_params(length=0)
    for spine in ax.spines.values(): spine.set_visible(False)
fig.text(.045,.055,"通过须同时满足编译、公开行为和保留检查。每对任务覆盖向左、向右两种方向。",color="#405967")
fig.subplots_adjust(left=.15,right=.97,bottom=.18,top=.73,wspace=.35)
fig.savefig(folder / "outcomes.png",dpi=160,facecolor="white")
