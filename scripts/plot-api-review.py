"""Plot second-pass correctness and the paired repair/regression tradeoff."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

folder = Path("docs/experiments/2026-11-28-review")
s = json.loads((folder/"summary.json").read_text(encoding="utf8"))
for font in ("Microsoft YaHei","Noto Sans CJK SC","SimHei"):
    if any(f.name==font for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"]=font
        break
fig,(left,right)=plt.subplots(1,2,figsize=(10.8,4.5),gridspec_kw={"width_ratios":[1.08,1]})
fig.suptitle("模型再检查一遍，能修对多少？又会改坏多少？",x=.04,y=.98,ha="left",fontsize=17,weight="bold",color="#19343e")
colors=["#77878b","#547d99","#167263"]
labels=["保留初稿","普通复查","边界复查"]
base=s["baseline"]["passed"]
values=[base/24,s["arms"]["G"]["passed"]/48,s["arms"]["E"]["passed"]/48]
text=[f"{base}/24"]+[str(s["arms"][g]["passed"])+"/48" for g in ("G","E")]
for i,(value,label) in enumerate(zip(values,text)):
    left.barh(i,1,height=.5,color="#eaf0ef")
    left.barh(i,value,height=.5,color=colors[i])
    left.text(1.02,i,f"{label}  ({value:.0%})",va="center",fontsize=10)
left.set_title("全部检查通过",loc="left",pad=16)
left.set(xlim=(0,1.47),ylim=(2.65,-.65),xticks=[],yticks=range(3),yticklabels=labels)
right.set_title("相对同一份初稿的变化（次）",loc="left",pad=16)
limit=max(2,max(s["arms"][g][k] for g in ("G","E") for k in ("fixed","regressed"))*1.22+1)
for i,g in enumerate(("G","E")):
    for off,key,color in [(-.17,"fixed","#167263"),(.17,"regressed","#aa5d47")]:
        val=s["arms"][g][key];right.barh(i+off,val,height=.27,color=color)
        right.text(val+.25,i+off,str(val),va="center")
right.set(yticks=[0,1],yticklabels=labels[1:],ylim=(1.55,-.56),xlim=(0,limit),xticks=[])
right.legend(["改对","改坏"],loc="lower right",bbox_to_anchor=(1,-.05),frameon=False,ncol=2,fontsize=9)
for ax in (left,right):
    ax.tick_params(length=0)
    for spine in ax.spines.values():spine.set_visible(False)
fig.text(.04,.055,"24 道题，每种复查各做两次。初稿每题评分一次。右图按每份复查稿与对应初稿比较。",fontsize=9,color="#4b6266")
fig.subplots_adjust(left=.13,right=.98,bottom=.2,top=.77,wspace=.36)
fig.savefig(folder/"outcomes.png",dpi=160,facecolor="white")
