// The return trip: comments minted against snapshot 0 of a corpus history, resolved against a
// later snapshot of the same lineage. Reports the spec section 6.6 status the section-level
// reference gets, and what the sub-section selector does inside a flagged-changed section.
import fs from 'node:fs/promises';
import {sections,canonicalScope,hash} from '../addressing/model.mjs';
import {lineMap,charMap,resolveQuoteExact,resolveCharOffset} from './anchors.mjs';

const input=JSON.parse(await fs.readFile('.antiphon/addressing-work/sparse-history-input.json','utf8'));
const DISTANCES=[1,4,16,32],QUOTE=40,CTX=40;

function trailKeys(parsed){
  const lines=parsed.text.split('\n'),keys=[],seen=new Map();
  for(let i=0;i<parsed.sections.length-1;i++){
    const chain=[];let k=i;
    while(k!==null){chain.unshift(k);k=parsed.sections[k+1].parent;}
    const parts=chain.map(x=>{const s=parsed.sections[x+1];return lines.slice(s.start,s.headingEnd).join('\n');});
    const bk=JSON.stringify(parts),n=seen.get(bk)??0;seen.set(bk,n+1);
    keys.push(JSON.stringify([parts,n]));
  }
  return keys;
}

const rows=[];
for(const corpus of input){
  const base=corpus.snapshots[0],threads=[];
  for(const [path,oid] of Object.entries(base)){
    const p=sections(Buffer.from(corpus.blobs[oid])),keys=trailKeys(p);
    for(let i=0;i<keys.length;i++){
      const s=p.sections[i+1],body=canonicalScope(s.source);
      if(body.length<QUOTE+8)continue;
      const start=Math.min(Math.floor(body.length/3),body.length-QUOTE),quote=body.slice(start,start+QUOTE);
      let occ=0,idx=body.indexOf(quote);
      while(idx>=0&&idx<start){occ++;idx=body.indexOf(quote,idx+1);}
      threads.push({path,key:keys[i],expect:s.digest,quote,occurrence:occ,start,end:start+QUOTE,
        prefix:body.slice(Math.max(0,start-CTX),start),suffix:body.slice(start+QUOTE,start+QUOTE+CTX)});
    }
  }
  const row={corpus:corpus.corpus,documents:Object.keys(base).length,threads:threads.length,byDistance:{}};
  for(const k of DISTANCES){
    if(k>=corpus.snapshots.length)continue;
    const later=corpus.snapshots[k];
    const st={documentGone:0,sectionRootMissing:0,sectionSurvives:0,sectionFlaggedChanged:0,
      inSurvivingSectionAnchorExact:0,inSurvivingSectionAnchorMoved:0,
      changed:{quoteRelocatedCorrect:0,quoteRelocatedWrong:0,quoteDetachedCorrect:0,quoteDetachedFalse:0,
               offsetCorrect:0,offsetWrong:0,offsetOutOfRange:0}};
    const cache=new Map();
    const parsedOf=oid=>{if(!cache.has(oid))cache.set(oid,sections(Buffer.from(corpus.blobs[oid])));return cache.get(oid);};
    for(const t of threads){
      const oidNow=later[t.path];
      if(!oidNow){st.documentGone++;continue;}
      const pb=parsedOf(oidNow),kb=trailKeys(pb),bi=kb.indexOf(t.key);
      if(bi<0){st.sectionRootMissing++;continue;}
      const sb=pb.sections[bi+1],body=canonicalScope(sb.source);
      if(sb.digest===t.expect){
        st.sectionSurvives++;
        (body.slice(t.start,t.end)===t.quote)?st.inSurvivingSectionAnchorExact++:st.inSurvivingSectionAnchorMoved++;
        continue;
      }
      st.sectionFlaggedChanged++;
      // ground truth for the anchored run of characters, from a diff of the two section bodies
      const oidBase=base[t.path],pa=parsedOf(oidBase),ka=trailKeys(pa),ai=ka.indexOf(t.key);
      const aBody=canonicalScope(pa.sections[ai+1].source);
      const aL=aBody.split('\n'),bL=body.split('\n');
      const {map:cm}=charMap(aL,bL,lineMap(aL,bL));
      let first=cm.get(t.start),ok=first!==undefined;
      if(ok)for(let q=1;q<QUOTE;q++)if(cm.get(t.start+q)!==first+q){ok=false;break;}
      if(ok&&body.slice(first,first+QUOTE)!==t.quote)ok=false;
      const gt=ok?{start:first,end:first+QUOTE}:null;
      const q=resolveQuoteExact(t,body),o=resolveCharOffset(t,body);
      if(gt){
        if(q&&q.start===gt.start)st.changed.quoteRelocatedCorrect++;
        else if(q)st.changed.quoteRelocatedWrong++;
        else st.changed.quoteDetachedFalse++;
        if(!o)st.changed.offsetOutOfRange++;
        else if(o.start===gt.start&&body.slice(o.start,o.end)===t.quote)st.changed.offsetCorrect++;
        else st.changed.offsetWrong++;
      } else {
        if(q)st.changed.quoteRelocatedWrong++;else st.changed.quoteDetachedCorrect++;
        if(!o)st.changed.offsetOutOfRange++;
        else if(body.slice(o.start,o.end)===t.quote)st.changed.offsetWrong++;else st.changed.offsetWrong++;
      }
    }
    row.byDistance[k]=st;
  }
  rows.push(row);
  console.error(`${row.corpus}: ${row.threads} threads over ${row.documents} documents`);
}
await fs.writeFile('docs/investigations/review-comments/return-results.json',
  JSON.stringify({distances:DISTANCES,quoteLength:QUOTE,context:CTX,corpora:rows},null,1)+'\n');
console.error('written');
