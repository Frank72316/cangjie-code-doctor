// Fetch only a data file from the designated repository; subsequent scoring uses the original checkout.
import {readFile,writeFile} from 'node:fs/promises';
import {sha} from './pilot-common.mjs';
const folder='docs/experiments/2026-11-26-challenge/formal/';
const first=JSON.parse(await readFile(folder+'first.json','utf8'));
const receipt=JSON.parse(await readFile('runs/evaluation-public/receipt.json','utf8'));
const base='https://api.github.com/repos/Frank72316/cangjie-code-doctor';
for (let attempt=0;attempt<180;attempt++) {
  const headers={Accept:'application/vnd.github+json','User-Agent':'doctor-experiment'};
  if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
  try {
    const ref=await fetch(base+'/git/ref/heads/main',{headers,signal:AbortSignal.timeout(10000)});
    if(ref.ok) {
      const commit=(await ref.json()).object.sha;
      if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Main SHA unavailable');
      const response=await fetch(base+'/contents/'+folder+'second.json?ref='+commit,{headers:{...headers,Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(15000)});
      if(response.ok) {
        const second=await response.json();
        if(second.finishedAt && second.firstSha256===sha(first) && second.publicReceiptSha256===sha(receipt)) {
          await writeFile(folder+'public.json',JSON.stringify(receipt,null,2));
          await writeFile(folder+'second.json',JSON.stringify(second,null,2));
          console.log('Locked second-round data commit '+commit);
          process.exit(0);
        }
      }
    }
  } catch { /* transient download failures leave the scorer waiting for the same frozen data */ }
  await new Promise(done=>setTimeout(done,15000));
}
throw Error('Matching second-round pack unavailable before deadline');
