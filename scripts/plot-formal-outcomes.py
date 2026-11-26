"""Plot the distribution of successes per question from the audited formal summary."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
from matplotlib import font_manager

folder = Path("docs/experiments/2026-11-26-challenge/formal")
data = json.loads((folder / "summary.json").read_text(encoding="utf-8-sig"))
for font in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = font
        break
labels = {
    "api_copy_filter":"复制并过滤列表", "api_frequency":"文本频次", "api_matrix_alias":"矩阵行引用",
    "api_optional_clamp":"Option 限幅", "api_parse_skip":"解析并跳过无效项", "api_range_slice":"闭区间切片",
    "api_rune_rotate":"Unicode 码点旋转", "api_stable_unique":"稳定去重",
    "algo_coin_change":"零钱组合", "algo_common_substring":"最长公共子串", "algo_edit_distance":"编辑距离",
    "algo_knapsack":"0/1 背包", "algo_lis":"严格递增子序列", "algo_max_segment":"最大连续子段",
    "algo_next_permutation":"下一个排列", "algo_shortest_paths":"最短路径",
    "state_bank":"账户转账", "state_books":"库存变动", "state_camel_map":"键名归一化", "state_complex":"复数运算",
    "state_hotel":"预约与入住", "state_pagination":"分页与检索", "state_registration":"课程登记", "state_rpg":"角色经验与攻击",
}
colors = ListedColormap(["#f7f4ed", "#cbdedb", "#74aaa4", "#195b58"])
fig, axes = plt.subplots(1, 3, figsize=(13.2, 5.8))
for ax, (stratum, title) in zip(axes, [("language-api","语言与 API"), ("algorithm","算法与边界"), ("stateful","类与状态")]):
    rows = [r for r in data["cases"] if r["stratum"] == stratum]
    ids = sorted({r["caseId"] for r in rows})
    counts = [[sum(r["caseId"]==cid and r["group"]==g and r["final"]=="passed" for r in rows) for g in "ABC"] for cid in ids]
    ax.imshow(counts, cmap=colors, norm=BoundaryNorm([-.5,.5,1.5,2.5,3.5],4), aspect="auto")
    ax.set_xticks(range(3), ["A","B","C"]); ax.xaxis.tick_top()
    ax.set_yticks(range(len(ids)), [labels[cid] for cid in ids])
    ax.tick_params(length=0, pad=5)
    ax.set_title(title, loc="left", fontsize=14, pad=18)
    for i, row in enumerate(counts):
        for j, value in enumerate(row):
            ax.text(j,i,str(value),ha="center",va="center",color="white" if value==3 else "#172c2c",fontsize=12)
    for spine in ax.spines.values(): spine.set_visible(False)
fig.suptitle("24 道仓颉修复题在三种文档条件下的表现", fontsize=18, x=.05, ha="left")
fig.text(.05,.025,"每格为 3 次重复中最终通过的次数。A 无文档，B 按题检索，C 固定速查表。",fontsize=11)
fig.tight_layout(rect=[.015,.07,.995,.91],w_pad=2)
fig.savefig(folder/"outcomes.png",dpi=180,bbox_inches="tight",facecolor="white")
