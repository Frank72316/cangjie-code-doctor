"""Plot repair outcomes and document selection on the preregistered task panels."""
from pathlib import Path
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
folder=Path("docs/experiments/2026-11-28-router")
data=json.loads((folder/"summary.json").read_text(encoding="utf8"))
for font in ("Microsoft YaHei","Noto Sans CJK SC","SimHei"):
    if any(f.name==font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"]=font
        break
styles=[("L","只给链表文档","#8b9aa0"),("S","按源码选","#507d92"),("J","按源码和题意选","#167368"),("A","总加节点和示例","#695985")]
fig,axes=plt.subplots(1,2,figsize=(10.5,4.2))
fig.suptitle("根据源码和题意选文档，修复结果有何变化？",x=.045,y=.975,ha="left",fontsize=17,weight="bold",color="#183840")
for ax,panel,title,n in zip(axes,["new","prior"],["24 道新题","8 道已有题，重新生成"],[72,24]):
    ax.set_title(title,loc="left",pad=10,fontsize=12)
    for i,(g,label,color) in enumerate(styles):
        passed=data["panels"][panel][g]["passed"]
        ax.barh(i,n,height=.54,color="#edf1f2")
        ax.barh(i,passed,height=.54,color=color)
        ax.text(n+.025*n,i,f"{passed}/{n}",va="center",fontsize=11)
    ax.set(xlim=(0,n*1.22),ylim=(3.7,-.7),xticks=[],yticks=list(range(4)),yticklabels=[x[1] for x in styles])
    ax.tick_params(length=0)
    for spine in ax.spines.values():spine.set_visible(False)
fig.text(.045,.055,"每道题每种实际文档条件独立生成三次。自动策略使用自己选中的那份回答。通过要求编译、公开和保留检查均成功。",fontsize=9,color="#495e66")
fig.subplots_adjust(left=.17,right=.98,wspace=.54,bottom=.18,top=.79)
fig.savefig(folder/"outcomes.png",dpi=160,facecolor="white")
