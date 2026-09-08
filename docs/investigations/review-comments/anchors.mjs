// CARD review-comments: sub-section anchor stability over the real corpus histories.
// Not a production implementation. Reuses CARD-0004's parse/digest primitives unchanged.
import {sections,canonicalScope,hash} from '../addressing/model.mjs';

// ---------- ground truth: patience-style line diff, then bounded char LCS in each unmatched hunk

function patienceLines(a,b,ai,aj,bi,bj,out){
  while(ai<aj&&bi<bj&&a[ai]===b[bi]){out.set(ai,bi);ai++;bi++;}
  while(ai<aj&&bi<bj&&a[aj-1]===b[bj-1]){out.set(aj-1,bj-1);aj--;bj--;}
  if(ai>=aj||bi>=bj)return;
  const ca=new Map(),cb=new Map();
  for(let i=ai;i<aj;i++)ca.set(a[i],(ca.get(a[i])??0)+1);
  for(let i=bi;i<bj;i++)cb.set(b[i],(cb.get(b[i])??0)+1);
  const pos=new Map();
  for(let i=bi;i<bj;i++)if(cb.get(b[i])===1&&ca.get(b[i])===1)pos.set(b[i],i);
  const pts=[];
  for(let i=ai;i<aj;i++)if(pos.has(a[i]))pts.push([i,pos.get(a[i])]);
  if(!pts.length){ // fall back to a bounded Hunt-Szymanski-free LCS when the hunk is small
    if((aj-ai)*(bj-bi)>250000)return;
    const m=aj-ai,n=bj-bi,dp=new Uint32Array((m+1)*(n+1));
    for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--)
      dp[i*(n+1)+j]=a[ai+i]===b[bi+j]?dp[(i+1)*(n+1)+j+1]+1:Math.max(dp[(i+1)*(n+1)+j],dp[i*(n+1)+j+1]);
    let i=0,j=0;
    while(i<m&&j<n){
      if(a[ai+i]===b[bi+j]){out.set(ai+i,bi+j);i++;j++;}
      else if(dp[(i+1)*(n+1)+j]>=dp[i*(n+1)+j+1])i++;else j++;
    }
    return;
  }
  // longest increasing subsequence over the unique pairs
  const tails=[],back=new Array(pts.length).fill(-1),idx=[];
  for(let k=0;k<pts.length;k++){
    let lo=0,hi=idx.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(pts[idx[mid]][1]<pts[k][1])lo=mid+1;else hi=mid;}
    if(lo>0)back[k]=idx[lo-1];
    idx[lo]=k;
  }
  const chain=[];let k=idx.length?idx[idx.length-1]:-1;
  while(k>=0){chain.push(pts[k]);k=back[k];}
  chain.reverse();
  let pa=ai,pb=bi;
  for(const [x,y] of chain){patienceLines(a,b,pa,x,pb,y,out);out.set(x,y);pa=x+1;pb=y+1;}
  patienceLines(a,b,pa,aj,pb,bj,out);
}
export function lineMap(a,b){const out=new Map();patienceLines(a,b,0,a.length,0,b.length,out);return out;}

// Character-level correspondence for one unmatched region, bounded.
const CHAR_BUDGET=4000;
function charLcs(s,t){
  const m=s.length,n=t.length,dp=new Uint32Array((m+1)*(n+1));
  for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--)
    dp[i*(n+1)+j]=s[i]===t[j]?dp[(i+1)*(n+1)+j+1]+1:Math.max(dp[(i+1)*(n+1)+j],dp[i*(n+1)+j+1]);
  const map=new Map();let i=0,j=0;
  while(i<m&&j<n){
    if(s[i]===t[j]){map.set(i,j);i++;j++;}
    else if(dp[(i+1)*(n+1)+j]>=dp[i*(n+1)+j+1])i++;else j++;
  }
  return map;
}

// Full document-level char map: matched lines map exactly; unmatched runs get a bounded char LCS.
export function charMap(aLines,bLines,lm){
  const aOff=[],bOff=[];let o=0;
  for(const l of aLines){aOff.push(o);o+=l.length+1;}
  o=0;for(const l of bLines){bOff.push(o);o+=l.length+1;}
  const map=new Map();let truncated=0;
  let ai=0,bi=0;
  const matched=[...lm.entries()].sort((x,y)=>x[0]-y[0]);
  const emitRun=(a0,a1,b0,b1)=>{
    if(a0>=a1)return;
    const s=aLines.slice(a0,a1).join('\n'),t=bLines.slice(b0,b1).join('\n');
    if(s.length*t.length>CHAR_BUDGET*CHAR_BUDGET||s.length>CHAR_BUDGET||t.length>CHAR_BUDGET){truncated++;return;}
    const cm=charLcs(s,t);
    for(const [x,y] of cm)map.set(aOff[a0]+x,bOff[b0]+y);
  };
  for(const [a,b] of matched){
    emitRun(ai,a,bi,b);
    for(let k=0;k<aLines[a].length;k++)map.set(aOff[a]+k,bOff[b]+k);
    map.set(aOff[a]+aLines[a].length,bOff[b]+bLines[b].length); // the newline slot
    ai=a+1;bi=b+1;
  }
  emitRun(ai,aLines.length,bi,bLines.length);
  return {map,truncated};
}

// ---------- selectors, each seeing only what a stored anchor would carry

export function resolveLineOrdinal(anchor,bSection){
  const lines=bSection.split('\n');
  if(anchor.lineOrdinal>=lines.length)return null;
  let off=0;for(let i=0;i<anchor.lineOrdinal;i++)off+=lines[i].length+1;
  return {start:off,end:off+lines[anchor.lineOrdinal].length};
}
export function resolveCharOffset(anchor,bSection){
  if(anchor.end>bSection.length)return null;
  return {start:anchor.start,end:anchor.end};
}
export function resolveQuoteExact(anchor,bSection){
  const q=anchor.quote,hits=[];let i=bSection.indexOf(q);
  while(i>=0){hits.push(i);i=bSection.indexOf(q,i+1);}
  if(!hits.length)return null;
  if(hits.length===1)return {start:hits[0],end:hits[0]+q.length};
  if(anchor.occurrence<hits.length)return {start:hits[anchor.occurrence],end:hits[anchor.occurrence]+q.length};
  return null;
}
export function resolveQuoteContext(anchor,bSection){
  const q=anchor.quote,hits=[];let i=bSection.indexOf(q);
  while(i>=0){hits.push(i);i=bSection.indexOf(q,i+1);}
  if(!hits.length)return null;
  if(hits.length===1)return {start:hits[0],end:hits[0]+q.length};
  const score=h=>{
    const pre=bSection.slice(Math.max(0,h-anchor.prefix.length),h),suf=bSection.slice(h+q.length,h+q.length+anchor.suffix.length);
    let s=0;
    for(let k=1;k<=Math.min(pre.length,anchor.prefix.length);k++){if(pre[pre.length-k]===anchor.prefix[anchor.prefix.length-k])s++;else break;}
    for(let k=0;k<Math.min(suf.length,anchor.suffix.length);k++){if(suf[k]===anchor.suffix[k])s++;else break;}
    return s;
  };
  const scored=hits.map(h=>[score(h),h]).sort((x,y)=>y[0]-x[0]);
  if(scored.length>1&&scored[0][0]===scored[1][0])return null; // ambiguous: refuse rather than guess
  return {start:scored[0][1],end:scored[0][1]+q.length};
}
