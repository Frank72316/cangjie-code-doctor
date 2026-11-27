"""Draw observed retrieval and repair outcomes without combining denominators."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle

root = Path("docs/experiments/2026-11-27-api-families")
study = json.loads((root / "summary.json").read_text(encoding="utf-8"))
for family in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == family for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = family
        break
names = ["队首连续出队", "插队并保留旧队列", "查看队尾", "查看栈顶", "按预算弹栈", "按深度读栈",
         "严格后继的值", "移除最小键值对", "不大于阈值的键", "严格前驱", "按阈值删除", "上界与阈值之差"]
fig, ax = plt.subplots(figsize=(10, 6))
ax.set_xlim(0, 11)
ax.set_ylim(-1.5, 13.5)
ax.axis("off")
ink, muted, yes, no = "#152e3b", "#496674", "#236963", "#edf0ef"
ax.text(.1,13,"找对方法文档之后，程序修对了吗？",fontsize=20,color=ink,weight="bold")
ax.text(.1,12.25,"12 道新题  ·  每题每种修复条件各两次  ·  同时检查返回值和集合状态",fontsize=10,color=muted)
xs=[5.05,6.2,7.35,9,10.15]
for x,s in zip(xs,["BM25","字段","加类型","字段","加类型"]):
    ax.text(x,11.35,s,ha="center",fontsize=10,color=ink)
ax.text(6.2,11.94,"第一条文档命中",ha="center",fontsize=11,color=ink)
ax.text(9.57,11.94,"修复通过次数",ha="center",fontsize=11,color=ink)
for i,(row,name) in enumerate(zip(study["rows"], names, strict=True)):
    y=10.55-i*.87
    if i%3==0:
        ax.axhline(y+.42,xmin=.01,xmax=.99,linewidth=.7,color="#c7d0d2")
        ax.text(.12,y,row["family"],va="center",fontsize=9,color=muted)
    ax.text(1.70,y,name,va="center",fontsize=10,color=ink)
    values=[int(row["retrieval"][g]["hit1"]) for g in "BFT"]+[row["passed"][g] for g in "FT"]
    for j,(x,v) in enumerate(zip(xs,values)):
        label=("中" if v else "—") if j<3 else f"{v}/2"
        fill=(yes if v else no) if j<3 else ["#f2ebe6","#bedbd8",yes][v]
        ax.add_patch(Rectangle((x-.48,y-.33),.96,.66,facecolor=fill,edgecolor="none"))
        ax.text(x,y,label,va="center",ha="center",fontsize=10,color="white" if fill==yes else ink)
ax.text(.12,-.88,"文档命中按事先登记的可接受条目计。BM25 仅参与检索评估。",fontsize=9,color=muted)
fig.subplots_adjust(left=.025,right=.99,bottom=.025,top=.985)
fig.savefig(root/"outcomes.png",dpi=160,facecolor="white")
