// Sub-section anchor stability over real document revision chains from the two corpus repositories.
// Each anchor is placed at revision i and re-resolved at revision i+k, for several k.
// The selectors see only what a stored anchor would carry; the ground truth sees both revisions.
import fs from 'node:fs/promises';
import {sections,canonicalScope,hash} from '../addressing/model.mjs';
import {lineMap,charMap,resolveLineOrdinal,resolveCharOffset,resolveQuoteExact,resolveQuoteContext} from './anchors.mjs';

const work='.antiphon/review-work';
const input=JSON.parse(await fs.readFile(`${work}/pairs.json`,'utf8'));
const SELECTORS={lineOrdinal:resolveLineOrdinal,charOffset:resolveCharOffset,quoteExact:resolveQuoteExact,quoteContext:resolveQuoteContext};
const DISTANCES=[1,2,4,8];
const PER_SECTION_LINES=4,PER_SECTION_SPANS=2,SPAN_LEN=40,CONTEXT=40;

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
const parseCache=new Map();
const parsed=(oid,src)=>{if(!parseCache.has(oid))parseCache.set(oid,sections(Buffer.from(src)));return parseCache.get(oid);};

const emptyBuckets=()=>({hit:0,misplaced:0,falseDetach:0,correctDetach:0,phantom:0});
const emptyStat=()=>{const s={pairsMeasured:0,sectionsChecked:0,sectionsLostByTrail:0,anchors:0,anchorsLine:0,anchorsSpan:0,
  gtSurvives:0,gtDetached:0,movedOutOfSection:0,
  digest:{targetIntactSectionDigestChanged:0,targetIntactSectionDigestSame:0,targetGoneSectionDigestSame:0,targetIntactDocDigestChanged:0},
  selectors:{},byGranularity:{line:{},span:{}}};
  for(const k of Object.keys(SELECTORS)){s.selectors[k]=emptyBuckets();s.byGranularity.line[k]=emptyBuckets();s.byGranularity.span[k]=emptyBuckets();}
  return s;};

const rows=[];
for(const corpus of input){
  const chains=new Map();
  const byPath=new Map();
  for(const p of corpus.pairs){if(!byPath.has(p.path))byPath.set(p.path,[]);byPath.get(p.path).push(p);}
  for(const [path,ps] of byPath){
    ps.reverse(); // git log is newest-first; make it chronological
    const seq=[ps[0].a];
    for(const p of ps){if(p.a!==seq.at(-1))break;seq.push(p.b);}
    if(seq.length>=2)chains.set(path,seq);
  }
  const row={corpus:corpus.corpus,repo:corpus.repo,documents:chains.size,
    revisions:[...chains.values()].reduce((n,s)=>n+s.length,0),byDistance:{}};
  for(const k of DISTANCES)row.byDistance[k]=emptyStat();
  for(const [path,seq] of chains){
    for(let i=0;i+1<seq.length;i++){
      const pa=parsed(seq[i],corpus.blobs[seq[i]]);
      const aLines=pa.text.split('\n');
      const aOff=[];{let o=0;for(const l of aLines){aOff.push(o);o+=l.length+1;}}
      const ka=trailKeys(pa);
      for(const k of DISTANCES){
        if(i+k>=seq.length)continue;
        if(corpus.blobs[seq[i]]===corpus.blobs[seq[i+k]])continue;
        const stat=row.byDistance[k];stat.pairsMeasured++;
        const pb=parsed(seq[i+k],corpus.blobs[seq[i+k]]);
        const bLines=pb.text.split('\n');
        const bOff=[];{let o=0;for(const l of bLines){bOff.push(o);o+=l.length+1;}}
        const lm=lineMap(aLines,bLines);
        const {map:cm}=charMap(aLines,bLines,lm);
        const bIndex=new Map();trailKeys(pb).forEach((key,idx)=>{if(!bIndex.has(key))bIndex.set(key,idx);});
        const docDigestChanged=pa.documentDigest!==pb.documentDigest;
        for(let si=0;si<ka.length;si++){
          const bi=bIndex.get(ka[si]);
          if(bi===undefined){stat.sectionsLostByTrail++;continue;}
          stat.sectionsChecked++;
          const sa=pa.sections[si+1],sb=pb.sections[bi+1];
          const aSectionText=canonicalScope(aLines.slice(sa.start,sa.end).join('\n'));
          const bSectionText=canonicalScope(bLines.slice(sb.start,sb.end).join('\n'));
          const aSecStart=aOff[sa.start],bSecStart=bOff[sb.start];
          const sectionDigestChanged=sa.digest!==sb.digest;
          const cands=[];
          for(let li=sa.headingEnd;li<sa.end;li++){
            const text=aLines[li];if(!text.trim())continue;
            cands.push({g:'line',docStart:aOff[li],text,lineOrdinal:li-sa.start});
            if(text.length>=60){const s=Math.floor((text.length-SPAN_LEN)/2);
              cands.push({g:'span',docStart:aOff[li]+s,text:text.slice(s,s+SPAN_LEN),lineOrdinal:li-sa.start});}
          }
          const pick=(g,n,tag)=>cands.filter(c=>c.g===g).sort((x,y)=>hash(tag+path+x.docStart).localeCompare(hash(tag+path+y.docStart))).slice(0,n);
          for(const c of [...pick('line',PER_SECTION_LINES,'L'),...pick('span',PER_SECTION_SPANS,'S')]){
            const aStart=c.docStart-aSecStart,aEnd=aStart+c.text.length;
            if(aStart<0||aEnd>aSectionText.length)continue;
            const quote=aSectionText.slice(aStart,aEnd);
            if(quote!==c.text)continue;
            stat.anchors++;c.g==='line'?stat.anchorsLine++:stat.anchorsSpan++;
            let gt=null,contiguous=true;
            const first=cm.get(c.docStart);
            if(first===undefined)contiguous=false;
            else for(let q=1;q<c.text.length;q++){if(cm.get(c.docStart+q)!==first+q){contiguous=false;break;}}
            if(contiguous){
              const bs=first-bSecStart,be=bs+c.text.length;
              if(bs<0||be>bSectionText.length){stat.movedOutOfSection++;gt='outside';}
              else if(bSectionText.slice(bs,be)!==c.text)gt='detached';
              else gt={start:bs,end:be};
            } else gt='detached';
            if(gt==='outside')continue;
            const survives=gt!=='detached';
            survives?stat.gtSurvives++:stat.gtDetached++;
            if(survives){
              sectionDigestChanged?stat.digest.targetIntactSectionDigestChanged++:stat.digest.targetIntactSectionDigestSame++;
              if(docDigestChanged)stat.digest.targetIntactDocDigestChanged++;
            } else if(!sectionDigestChanged)stat.digest.targetGoneSectionDigestSame++;
            let occ=0,idx=aSectionText.indexOf(quote);
            while(idx>=0&&idx<aStart){occ++;idx=aSectionText.indexOf(quote,idx+1);}
            const anchor={quote,occurrence:occ,start:aStart,end:aEnd,lineOrdinal:c.lineOrdinal,
              prefix:aSectionText.slice(Math.max(0,aStart-CONTEXT),aStart),suffix:aSectionText.slice(aEnd,aEnd+CONTEXT)};
            for(const [name,fn] of Object.entries(SELECTORS)){
              const got=fn(anchor,bSectionText);
              const bucket=b=>{stat.selectors[name][b]++;stat.byGranularity[c.g][name][b]++;};
              if(survives){
                if(!got)bucket('falseDetach');
                else if(got.start===gt.start&&got.end===gt.end)bucket('hit');
                else bucket('misplaced');
              } else {if(!got)bucket('correctDetach');else bucket('phantom');}
            }
          }
        }
      }
    }
    parseCache.clear();
  }
  rows.push(row);
  console.error(`${row.corpus}: ${row.documents} documents, ${row.revisions} revisions, k=1 anchors ${row.byDistance[1].anchors}`);
}
await fs.writeFile('docs/investigations/review-comments/anchor-results.json',
  JSON.stringify({distances:DISTANCES,perSectionLines:PER_SECTION_LINES,perSectionSpans:PER_SECTION_SPANS,spanLength:SPAN_LEN,context:CONTEXT,corpora:rows},null,1)+'\n');
console.error('written');
