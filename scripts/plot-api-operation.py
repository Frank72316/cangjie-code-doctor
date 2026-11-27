"""Show paired search and downstream outcomes with explicit denominators."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

root = Path("docs/experiments/2026-11-27-operation")
s = json.loads((root / "summary.json").read_text(encoding="utf-8"))
for name in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(font.name == name for font in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break
plt.rcParams["axes.unicode_minus"] = False
fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.6), gridspec_kw={"width_ratios":[1.2, 1]})
ink="#183344"; muted="#4d6170"; blue="#58758c"; green="#127167"; gray="#8e959c"
fig.suptitle("检索选对了操作，程序修复也会改善吗？",x=.035,y=.99,ha="left",fontsize=18,color=ink,weight="bold")
specs = [
    (axes[0], "相关文档排在首位", 12, [
        ("原题 · 仅类型",s["retrievalTotals"]["T"]["primary"]["hit1"],blue),
        ("原题 · 类型和操作",s["retrievalTotals"]["I"]["primary"]["hit1"],green),
        ("改述 · 仅类型",s["retrievalTotals"]["T"]["alternate"]["hit1"],blue),
        ("改述 · 类型和操作",s["retrievalTotals"]["I"]["alternate"]["hit1"],green)]),
    (axes[1], "修复通过公开和保留测试", 24, [
        ("仅通用指南",s["overall"]["G"],gray),
        ("加类型检索",s["overall"]["T"],blue),
        ("加类型和操作",s["overall"]["I"],green)])]
for ax,title,den,items in specs:
    ax.set_title(title,loc="left",color=ink,pad=12,fontsize=13)
    for i,(label,value,color) in enumerate(items):
        ax.barh(i,den,color="#eef1f2",height=.53)
        ax.barh(i,value,color=color,height=.53)
        ax.text(den+.35,i,f"{value}/{den}",va="center",fontsize=10,color=ink)
    ax.set_xlim(0,den*1.23)
    ax.set_yticks(range(len(items)),[x[0] for x in items],color=ink,fontsize=10)
    ax.set_ylim(len(items)-.45,-.55)
    ax.set_xticks([])
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
fig.text(.035,.06,"六对新任务，每题两种表述。修复实验只使用原题，每题每组独立请求两次。",color=muted,fontsize=10)
fig.subplots_adjust(left=.155,right=.985,bottom=.2,top=.78,wspace=.46)
fig.savefig(root/"outcomes.png",dpi=160,facecolor="white")
