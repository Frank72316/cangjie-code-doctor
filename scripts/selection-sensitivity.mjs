import assert from 'node:assert/strict';
import {read,setting,directory,dump} from './api-evidence-common.mjs';
import {selectExamples,contractResult} from './select-contract-examples.mjs';
import {decodePool,differs} from './selection-observations.mjs';

assert.equal(setting.generation,'api-selection');
const pool=read('pool'), gate=read('materials/receipt'), det=read('detection'), labels=read('fault-labels');
const panels={new:[],legacy:[]}, outside={};
for (let omit=-1;omit<pool.length;omit++){
  const result={new:{D:0,uniform:0},legacy:{D:0,uniform:0}};
  for(const [i,r] of det.cases.entries()){
    if(!r.hiddenFail)continue;
    const opts=selectExamples(r.id,pool,omit);
    const actual=decodePool(gate.rows[i].probe.starter,pool), target=decodePool(gate.rows[i].probe.reference,pool);
    const bad=actual.map((v,j)=>differs(v,target[j]));
    const n=pool.length-Number(omit>=0), good=bad.filter((v,j)=>!v && j!==omit).length;
    const probability=1-good*(good-1)/(n*(n-1));
    const hit=Number(opts.D.some(j=>bad[j]));
    result[r.panel].D+=hit; result[r.panel].uniform+=probability;
    if(omit===-1 && r.panel==='new'){
      const modeled=opts.variants.includes(labels[r.id]);
      if(modeled) assert.deepEqual(actual,pool.map(p=>contractResult(r.id,p.array,p.t,labels[r.id])));
      const b=outside[modeled?'modeled':'unmodeled']??={errors:0,D:0,U:0,uniform:0};
      b.errors++;b.D+=hit;b.U+=Number(r.U);b.uniform+=probability;
    }
  }
  for(const p of Object.keys(panels)){
    if(omit===-1){
      assert.equal(result[p].D,det.panels[p].D);
      assert.ok(Math.abs(result[p].uniform-det.panels[p].uniformExpected)<1e-9);
    } else panels[p].push({omittedIndex:omit,...result[p],net:result[p].D-result[p].uniform});
  }
}
const value={byAuthoredFault:outside,leaveOneInputOut:panels};
if(process.argv.includes('--write'))dump(directory+'/sensitivity.json',value);
if(process.argv.includes('--verify'))assert.deepEqual(value,read('sensitivity'));
console.log(JSON.stringify({byAuthoredFault:outside,ranges:Object.fromEntries(Object.entries(panels).map(([k,v])=>[k,[Math.min(...v.map(r=>r.net)),Math.max(...v.map(r=>r.net))]]))}));
