import fs from 'node:fs';
import {read} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {rankApiSections} from './rank-api-sections.mjs';

const development=read('design'), api=read('corpus');
const cases=development.cases.map(c=>{
  const p=JSON.parse(c.requests.M.messages[1].content);
  const order=rankApiSections(api,p.task,p.source.text);
  return {id:c.id,gold:c.gold,B:c.apiRanks,F:order.slice(0,3).map(r=>r.id),
    fieldRank:1+order.findIndex(r=>r.id===c.gold)};
});
const rankerSha256=sha(fs.readFileSync('scripts/rank-api-sections.mjs','utf8').replaceAll('\r\n','\n'));
console.log(JSON.stringify({rankerSha256,apiCorpusSha256:development.apiCorpusSha256,developmentSha256:sha(development),cases},null,2));
