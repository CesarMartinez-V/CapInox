import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const before=resolve('docs/design-comparison/implemented'),after=resolve('docs/design-comparison/recovery');
const files=(await readdir(after)).filter(name=>name.endsWith('.png'));
let passed=0;
for(const name of files){
  const a=await sharp(resolve(before,name)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(resolve(after,name)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(a.info.width!==b.info.width||a.info.height!==b.info.height)throw new Error(`Layout dimensions changed: ${name}`);
  let different=0;for(let i=0;i<a.data.length;i+=3)if(Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]))>25)different++;
  const pct=100*different/(a.info.width*a.info.height),ok=pct<=1;
  if(ok)passed++;
  console.log(`${ok?'PASS':'REVIEW'} ${name}: ${pct.toFixed(3)}% pixels >25/255`);
}
console.log(`Approved Claude UI preservation: ${passed}/${files.length} within 1% tolerance; this compares pre/post recovery, not Claude source parity.`);
if(passed!==files.length)process.exitCode=1;
