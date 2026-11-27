"""Plot the four crossed conditions and the two deployable natural-wording controls."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle

folder = Path("docs/experiments/2026-11-27-wording")
s = json.loads((folder/"summary.json").read_text(encoding="utf-8"))
counts = {g:v["passed"] for g,v in s["groups"].items()}
for family in ("Microsoft YaHei", "Noto Sans CJK SC", "SimHei"):
    if any(f.name == family for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = family
        break
ink,muted="#173747","#465c65"
fig,(grid,bars)=plt.subplots(1,2,figsize=(12,4.7),gridspec_kw={"width_ratios":[1.05,1]})
fig.suptitle("同一句日常描述，给哪种文档更容易修对？",x=.035,y=.98,ha="left",fontsize=20,weight="bold",color=ink)
grid.set_title("分开改变题面和检索用语",loc="left",color=ink,fontsize=13,pad=15)
grid.set_xlim(-.77,2.1);grid.set_ylim(-.14,2.73);grid.axis("off")
for col,subtitle in enumerate(["用技术表述检索","用日常表述检索"]):
    grid.text(col+.49,2.2,subtitle,ha="center",fontsize=11,color=ink)
for row,label in enumerate(["模型读技术题面","模型读日常题面"]):
    y=1-row
    grid.text(-.04,y+.49,label,ha="right",va="center",fontsize=10,color=ink)
    for col,g in enumerate((["FF","FN"],["NF","NN"])[row]):
        v=counts[g];color=plt.colormaps["Blues"](.13+.68*v/24)
        grid.add_patch(Rectangle((col+.02,y+.04),.95,.91,facecolor=color,edgecolor="none"))
        grid.text(col+.495,y+.49,f"{v}/24",ha="center",va="center",color="white" if v>=16 else ink,fontsize=17,weight="bold")
bars.set_title("模型统一读日常题面",loc="left",fontsize=13,color=ink,pad=15)
for i,(g,label) in enumerate([("NG","只有通用指南"),("NN","按日常表述检索"),("NS","源码类型签名清单")]):
    v=counts[g];bars.barh(i,24,height=.52,color="#eef2f1");bars.barh(i,v,height=.52,color="#17685e" if g=="NS" else "#668194")
    bars.text(24.5,i,f"{v}/24",va="center",fontsize=11,color=ink)
bars.set_yticks([0,1,2],["只有通用指南","按日常表述检索","源码类型签名清单"],color=ink)
bars.set_ylim(2.65,-.63);bars.set_xlim(0,28.5);bars.set_xticks([]);bars.tick_params(length=0)
for spine in bars.spines.values(): spine.set_visible(False)
fig.text(.035,.07,"每格为通过编译、公开与保留检查的次数。12 道题，每组每题两次。右图中“按日常表述检索”与左图右下角是同一组。",color=muted,fontsize=10)
fig.subplots_adjust(left=.04,right=.985,bottom=.19,top=.77,wspace=.34)
fig.savefig(folder/"outcomes.png",dpi=160,facecolor="white")
