import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const digest = s => createHash('sha256').update(s).digest('hex');
const alternatives = {
  best:['inclusive','tie','endpoint','short'],
  quota:['inclusive','direction','limit','count'],
  cross:['inclusive','direction','slope','rightIndex'],
  window:['scope','sign','zero','second'],
  index:['comparison','direction','oneBased','absentZero'],
  cap:['comparison','direction','all','oneBased'],
  streak:['comparison','count','tail','firstRun'],
  prefix:['comparison','includeStop','reverse','count']
};

export function contractResult(id, values, t, variant='correct') {
  const [family, a, b] = id.split('_'), seq = [...values], indices = seq.map((_,i)=>i);
  let value = -1;
  if (family === 'best' || family === 'streak') {
    const inclusive = family==='best' ? variant==='inclusive' : (a==='inclusive') !== (variant==='comparison');
    const runs = [];
    for (const i of indices) {
      if (!(inclusive ? seq[i]>=t : seq[i]>t)) continue;
      const last = runs.at(-1);
      if (last && last.at(-1)===i-1) last.push(i);
      else runs.push([i]);
    }
    if (family === 'best') {
      if ((a==='right') !== (variant==='tie')) runs.reverse();
      runs.sort((x,y)=>variant==='short'?x.length-y.length:y.length-x.length);
      if (runs.length) value = (b==='end') !== (variant==='endpoint') ? runs[0].at(-1) : runs[0][0];
    } else {
      if (variant==='count') value = runs.flat().length;
      else if (variant==='tail') value = runs.at(-1)?.at(-1)===seq.length-1 ? (runs.at(-1)?.length??0) : 0;
      else if (variant==='firstRun') value = runs[0]?.length??0;
      else value = Math.max(0,...runs.map(r=>r.length));
    }
  } else if (family==='quota' || family==='index' || family==='cap') {
    if ((a==='last') !== (variant==='direction')) indices.reverse();
    const inclusive = family==='index' ? variant!=='comparison' : ['comparison','inclusive'].includes(variant);
    const hits = indices.filter(i=>inclusive ? seq[i]>=t : seq[i]>t);
    if (family==='quota') {
      let limit = Number(b);
      if (variant==='limit') limit=3-limit;
      const chosen = hits.slice(0,limit);
      value = variant==='count' ? chosen.length : chosen.reduce((s,i)=>s+seq[i],0);
      for (const i of chosen) seq[i]=t;
    } else {
      value = hits[0]??(variant==='absentZero'?0:-1);
      if (hits.length && variant==='oneBased') value++;
      if (family==='cap') for (const i of (variant==='all'?hits:hits.slice(0,1))) seq[i]=t;
    }
  } else if (family==='cross') {
    const rising = (b==='up') !== (variant==='slope');
    const hits = indices.filter(i => i+1<seq.length && (rising
      ? (variant==='inclusive'?seq[i]<=t:seq[i]<t) && seq[i+1]>t
      : (variant==='inclusive'?seq[i]>=t:seq[i]>t) && seq[i+1]<t));
    value = ((a==='last') !== (variant==='direction') ? hits.at(-1) : hits[0]) ?? -1;
    if (value>=0 && variant==='rightIndex') value++;
  } else if (family==='window') {
    const marks = indices.filter(i=>seq[i]===t), inside = (a==='inside') !== (variant==='scope');
    const positive = (b==='pos') !== (variant==='sign');
    value = 0;
    if (marks.length>=2) {
      const lo=marks[0], hi=variant==='second'?marks[1]:marks.at(-1);
      for (const i of indices) {
        const active = inside ? i>lo && i<hi : i<lo || i>hi;
        if (active && ((positive?seq[i]>0:seq[i]<0) || (variant==='zero' && seq[i]===0))) {
          seq[i]=0; value++;
        }
      }
    }
  } else {
    assert.equal(family,'prefix');
    const inclusive = (a==='equal') !== (variant==='comparison');
    if (variant==='reverse') indices.reverse();
    value = 0;
    for (const i of indices) {
      if (inclusive ? seq[i]>=t : seq[i]>t) {
        if (variant==='includeStop') value += seq[i];
        break;
      }
      value += variant==='count'?1:seq[i];
    }
  }
  return {returned:value,after:seq};
}

export function poolInputs() {
  const inputs=[], used=new Set();
  for (let i=0;inputs.length<24;i++) {
    const bytes=Buffer.from(digest('doctor-contract-pool-v1/'+i),'hex');
    const array=Array.from(bytes.subarray(0,5),n=>[-3,-1,0,2,2,4,6][n%7]);
    if (used.has(JSON.stringify(array))) continue;
    used.add(JSON.stringify(array)); inputs.push({array,t:2});
  }
  return inputs;
}

function uniformIndex(id,n) {
  const limit = Math.floor(2**32/n)*n;
  for (let counter=0;;counter++) {
    const v=parseInt(digest('doctor-uniform-v1/'+id+'/'+counter).slice(0,8),16);
    if (v<limit) return v%n;
  }
}
export function selectExamples(id,inputs,omittedIndex=-1) {
  assert.ok(inputs.length>=2);
  const variants=['correct',...alternatives[id.split('_')[0]]];
  const outputs=inputs.map(({array,t})=>variants.map(v=>JSON.stringify(contractResult(id,array,t,v))));
  const pairs=[];
  for (let i=0;i<inputs.length;i++) for (let j=i+1;j<inputs.length;j++) {
    if (i===omittedIndex || j===omittedIndex) continue;
    let separatesCorrect=0,separatesAll=0;
    for (let a=0;a<variants.length;a++) for (let b=a+1;b<variants.length;b++) {
      if (outputs[i][a]===outputs[i][b] && outputs[j][a]===outputs[j][b]) continue;
      separatesAll++;
      if (a===0) separatesCorrect++;
    }
    pairs.push({indices:[i,j],separatesCorrect,separatesAll,tie:digest('doctor-selection-tie-v1/'+id+'/'+i+'/'+j)});
  }
  const U=pairs[uniformIndex(id,pairs.length)].indices;
  pairs.sort((a,b)=>b.separatesCorrect-a.separatesCorrect || b.separatesAll-a.separatesAll || (a.tie<b.tie?-1:1));
  return {U,D:pairs[0].indices,separatesCorrect:pairs[0].separatesCorrect,separatesAll:pairs[0].separatesAll,variants};
}
