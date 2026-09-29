import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const root=process.cwd(),refs=join(root,'design-reference','screens','canonical','4k'),shots=join(root,'tests','visual','screenshots'),out=join(root,'tests','visual','diffs');
const pairs=[['01_inbox_light.png','inbox-light-1920.png'],['02_inbox_dark.png','inbox-dark-1920.png'],['04_contacts_crm.png','contacts-light-1920.png'],['05_campaigns_dashboard.png','campaigns-light-1920.png'],['07_metrics_performance.png','metrics-light-1920.png'],['08_team_roles.png','team-light-1920.png'],['09_system_diagnostics.png','diagnostics-light-1920.png']];
const stats=[];
for(const [reference,screenshot] of pairs){
  try{
  const [ref,actual]=await Promise.all([sharp(join(refs,reference)).resize(1920,1080).removeAlpha().raw().toBuffer(),sharp(await readFile(join(shots,screenshot))).removeAlpha().raw().toBuffer()]);
  const diff=Buffer.allocUnsafe(ref.length);let sum=0,changed=0;
  for(let i=0;i<ref.length;i+=3){let magnitude=0;for(let c=0;c<3;c++){const delta=Math.abs(ref[i+c]-actual[i+c]);diff[i+c]=delta;magnitude+=delta;sum+=delta;}if(magnitude/3>30)changed++;}
  await sharp(diff,{raw:{width:1920,height:1080,channels:3}}).png().toFile(join(out,`diff-${screenshot}`));
  stats.push({screen:screenshot,meanAbsoluteErrorPct:Number((sum/ref.length/255*100).toFixed(2)),changedPixelsPct:Number((changed/(1920*1080)*100).toFixed(2))});
  }catch(error){stats.push({screen:screenshot,error:error instanceof Error?error.message:'Unknown image decoding error'});}
}
console.log(JSON.stringify({comparison:'canonical resized from 3840x2160 to 1920x1080 against isolated visual fixtures; differing data/content affect scores',stats},null,2));
if(stats.some(item=>'error' in item))process.exitCode=1;
