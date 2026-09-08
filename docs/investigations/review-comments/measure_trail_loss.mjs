// Why default roots vanish in the rust corpus: a whole-document heading-rank sweep.
import fs from 'node:fs/promises';
import {sections} from '../addressing/model.mjs';
const input=JSON.parse(await fs.readFile('.antiphon/review-work/pairs.json','utf8'));
function trails(p){const lines=p.text.split('\n'),out=[],seen=new Map();
 for(let i=0;i<p.sections.length-1;i++){const chain=[];let k=i;
  while(k!==null){chain.unshift(k);k=p.sections[k+1].parent;}
  const parts=chain.map(x=>{const s=p.sections[x+1];return lines.slice(s.start,s.headingEnd).join('\n');});
  const bk=JSON.stringify(parts),n=seen.get(bk)??0;seen.set(bk,n+1);out.push(JSON.stringify([parts,n]));}
 return out;}
const strip=t=>t.replace(/"#+ /g,'"H ');
const rows=[];
for(const c of input){
  let pairs=0,sectionsA=0,lost=0,lostRecoveredByRankStrip=0,allLostSameCount=0;
  for(const p of c.pairs){
    const pa=sections(Buffer.from(c.blobs[p.a])),pb=sections(Buffer.from(c.blobs[p.b]));
    const ka=trails(pa),kb=new Set(trails(pb)),kbStripped=new Set(trails(pb).map(strip));
    pairs++;sectionsA+=ka.length;
    const missing=ka.filter(k=>!kb.has(k));
    lost+=missing.length;
    lostRecoveredByRankStrip+=missing.filter(k=>kbStripped.has(strip(k))).length;
    if(ka.length&&missing.length===ka.length&&ka.length===kb.size)allLostSameCount++;
  }
  rows.push({corpus:c.corpus,pairs,sectionsA,lost,lostRecoveredByRankStrip,allLostSameCount});
  console.error(JSON.stringify(rows.at(-1)));
}
await fs.writeFile('docs/investigations/review-comments/trail-loss-results.json',JSON.stringify({corpora:rows},null,1)+'\n');
