"""One-shot repair results by case, with the observed repeat counts in each cell."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
from matplotlib import font_manager

folder = Path("docs/experiments/2026-11-26-api-evidence")
data = json.loads((folder / "summary.json").read_text(encoding="utf-8-sig"))
for name in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(font.name == name for font in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break
names = {"api_rune_rotate":"Unicode 码点轮转", "api_stable_unique":"稳定去重",
         "api_frequency":"文本频次", "api_copy_filter":"复制并过滤列表",
         "api_matrix_alias":"独立矩阵行", "api_parse_skip":"跳过非法整数",
         "api_optional_clamp":"可选值限幅", "api_range_slice":"闭区间切片",
         "new_odd_runes":"隔位取码点", "new_suffix_once":"只删一次后缀",
         "new_limited_fields":"限制分割段数", "new_trim_set":"按字符集修剪尾部"}
fig, axes = plt.subplots(1,2,figsize=(12.5,6.1),gridspec_kw={"wspace":.65})
colors = ListedColormap(["#f3ded3","#f0d29c","#c2ddd3","#22706b"])
for ax,panel,title in zip(axes, ["prior","transfer"], ["旧题复测 · 8 题","首次评估 · 4 题"]):
    rows = [c for c in data["cases"] if c["panel"]==panel]
    matrix = [[c["pass"][g] for g in "RMGP"] for c in rows]
    ax.imshow(matrix,cmap=colors,norm=BoundaryNorm([-.5,.5,1.5,2.5,3.5],4),aspect="auto",
              extent=(-.5,3.5,len(rows)-.5,-.5))
    ax.set_ylim(7.5,-.5)
    ax.set_yticks(range(len(rows)),[names[c["id"]] for c in rows])
    ax.set_xticks(range(4),["原检索","自动 API","指定 API","无关 API"])
    ax.xaxis.tick_top()
    ax.set_title(title,loc="left",fontsize=13,pad=23)
    ax.tick_params(length=0,pad=5)
    for axis in ax.spines.values(): axis.set_visible(False)
    for i,row in enumerate(matrix):
        for j,value in enumerate(row):
            ax.text(j,i,str(value),ha="center",va="center",fontsize=12,color="white" if value==3 else "#232f32")
fig.subplots_adjust(left=.12,right=.98,top=.75,bottom=.12)
fig.suptitle("四种文档条件下，每道仓颉程序的首轮修复结果",x=.035,y=.965,ha="left",fontsize=19)
fig.text(.035,.025,"每格是同一题三次独立请求中通过编译、公开样例和保留测试的次数。每次只允许生成一份修复。",fontsize=10)
fig.savefig(folder/"outcomes.png",dpi=160,bbox_inches="tight",facecolor="white")
