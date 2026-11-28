"""Draw the pre-registered detection and repair endpoints."""
from pathlib import Path
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

p=Path("docs/experiments/2026-11-28-selection")
def read(name):return json.loads((p/(name+".json")).read_text(encoding="utf-8"))
d=read("detection")["panels"]
s=read("summary")["panels"]
for family in ["Microsoft YaHei","Noto Sans CJK SC","SimHei"]:
    if any(f.name==family for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"]=family
        break
fig,(ax,bx)=plt.subplots(1,2,figsize=(11,4.8))
colors=["#738494","#b88b42","#207775"]
fig.suptitle("同样给两条样例，选法能改变什么？",x=.04,y=.98,ha="left",fontsize=17,fontweight="bold")
for i,(k,label) in enumerate([("U","固定随机"),("uniformExpected","所有随机选法的均值"),("D","按题意选")]):
    for j,panel in enumerate(("new","legacy")):
        a=d[panel]; n=a["errors"];v=a[k]; y=j+(i-1)*.22
        ax.barh(y,v/n,.16,color=colors[i],label=label if j==0 else None)
        text=f"{v:.2f}/{n}" if k=="uniformExpected" else f"{v}/{n}"
        ax.text(v/n+.022,y,text,va="center",fontsize=9)
for i,(group,label) in enumerate([("U","固定随机"),("D","按题意选")]):
    for j,panel in enumerate(("new","legacy")):
        a=s[panel][group];v=a["passedWhenTriggered"];n=a["runs"]; y=j+(i-.5)*.26
        bx.barh(y,v/n,.20,color=colors[2*i],label=label if j==0 else None)
        bx.text(v/n+.022,y,f"{v}/{n}",va="center",fontsize=9)
ax.set_title("初稿出错时，两条样例能否发现",loc="left",pad=12)
bx.set_title("检测到问题才复查，最终通过几次",loc="left",pad=12)
for a in (ax,bx):
    a.set(yticks=[0,1],yticklabels=["16 道新题","8 道复验题"],ylim=(1.52,-.53),xlim=(0,1.28),xticks=[0,.5,1],xticklabels=["0%","50%","100%"])
    a.tick_params(length=0)
    for spine in a.spines.values():spine.set_visible(False)
    a.legend(loc="upper left",bbox_to_anchor=(-.03,-.18),frameon=False,ncol=3,fontsize=8)
fig.text(.04,.03,"左图统计有错的初稿。右图每道题重复两次，跳过复查时沿用初稿。",fontsize=9,color="#4a6163")
fig.subplots_adjust(left=.12,right=.98,top=.80,bottom=.25,wspace=.42)
fig.savefig(p/"outcomes.png",dpi=160,facecolor="white")
