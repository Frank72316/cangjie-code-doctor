"""Compare exact API selection with actual first-attempt repair, by new task."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import BoundaryNorm, ListedColormap

folder = Path("docs/experiments/2026-11-27-api-ranking")
study = json.loads((folder / "summary.json").read_text(encoding="utf-8-sig"))
for font in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = font
        break
labels = {"symbol_pair":"比较码点位置","frame_columns":"字段加框","tag_depth":"连续标签计数",
          "case_streak":"连续单词段","last_reading":"最新合法读数","middle_copy":"去两端后复制",
          "empty_slots":"空标记的匹配位置","seat_label":"座位号右对齐","shared_badges":"共有徽章",
          "partition_balance":"数组分割差值","folded_votes":"忽略大小写计票","purge_window":"就地删除区间"}
fig, axes = plt.subplots(1, 2, figsize=(12.4, 5.9))
for ax, (panel, title) in zip(axes, [("seen","开发集出现过的目标 API"),("unseen","新目标 API")]):
    cases = [c for c in study["cases"] if c["panel"] == panel]
    values = [[int(c["hit1"][g])*3 for g in "BF"] + [c["pass"][g] for g in "BF"] for c in cases]
    colors = ListedColormap(["#f0e7da","#cbdce5","#85b2c4","#226584"])
    ax.imshow(values, cmap=colors, norm=BoundaryNorm([-.5,.5,1.5,2.5,3.5],4), aspect="auto")
    ax.set_yticks(range(6), [labels[c["id"]] for c in cases])
    ax.set_xticks(range(4), ["原排序","新排序","原排序","新排序"])
    ax.xaxis.tick_top()
    ax.tick_params(length=0, pad=4)
    ax.text(.25,1.12,"首位命中",transform=ax.transAxes,ha="center")
    ax.text(.75,1.12,"修复通过次数",transform=ax.transAxes,ha="center")
    ax.set_title(title, loc="left", fontsize=13, pad=53)
    ax.axvline(1.5,color="white",linewidth=4)
    for i,row in enumerate(values):
        for j,n in enumerate(row):
            text = ("命中" if n else "未中") if j < 2 else str(n)+"/3"
            ax.text(j,i,text,ha="center",va="center",color="white" if n==3 else "#17333e")
    for spine in ax.spines.values():
        spine.set_visible(False)
fig.subplots_adjust(left=.135,right=.98,top=.68,bottom=.14,wspace=.57)
fig.suptitle("API 条目排在第一位时，程序修好了吗？",x=.03,y=.97,ha="left",fontsize=19)
fig.text(.035,.073,"12 道全新修复题。命中按预先指定的条目计；每题每组三次独立调用，程序通过公开和保留测试才计入。",fontsize=10)
fig.text(.035,.026,"补充检查：空标记题的两组六份原通过候选，在新增的七组混合 Unicode 输入中均仅通过一组。",fontsize=10)
fig.savefig(folder/"outcomes.png", dpi=165, bbox_inches="tight", facecolor="white")
