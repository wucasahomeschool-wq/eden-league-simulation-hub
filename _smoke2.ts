import { buildEngineTeam, run_match } from "./src/engine/engine";
const attrs = (o:any={})=>({rating:7,FIN:7,SHO:7,PAS:7,VIS:7,DRI:7,PAC:7,STA:7,DEF:7,TAC:7,POS_attr:7,COM:7,WR:7,AGG:7,STR:7,AER:7,...o});
function roster(prefix:string){
  const r:any[]=[{name:prefix+"GK",position:"GK",...attrs({rating:9})}];
  const pos=["CB","CB","LB","RB","CM","CM","CAM","LW","RW","ST","ST","CB","CM","ST"];
  pos.forEach((p,i)=>r.push({name:`${prefix}${p}${i}`,position:p,...attrs()}));
  return r;
}
for(let i=0;i<30;i++){
  const A=buildEngineTeam("Alpha","Deep Block",roster("A"));
  const B=buildEngineTeam("Bravo","Deep Block",roster("B"));
  const p=run_match(A,B,1.0,0.05,true);
  if(p.log.some((l:string)=>l.includes("PENALTY SHOOTOUT"))){
    console.log("Tie -> shootout. Final",p.homeGoals,p.awayGoals);
    console.log(p.log.filter((l:string)=>l.includes("WINS THE SHOOTOUT")||l.includes("SUDDEN DEATH")).slice(0,3));
    process.exit(0);
  }
}
console.log("No tie occurred in 30 runs");
