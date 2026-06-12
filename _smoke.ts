import { buildEngineTeam, run_match } from "./src/engine/engine";
const attrs = (o:any={})=>({rating:7,FIN:7,SHO:7,PAS:7,VIS:7,DRI:7,PAC:7,STA:7,DEF:7,TAC:7,POS_attr:7,COM:7,WR:7,AGG:7,STR:7,AER:7,...o});
function roster(prefix:string){
  const r:any[]=[{name:prefix+"GK",position:"GK",...attrs()}];
  const pos=["CB","CB","LB","RB","CM","CM","CAM","LW","RW","ST","ST","CB","CM","ST"];
  pos.forEach((p,i)=>r.push({name:`${prefix}${p}${i}`,position:p,...attrs()}));
  return r;
}
const A=buildEngineTeam("Alpha","Balanced",roster("A"));
const B=buildEngineTeam("Bravo","Balanced",roster("B"));
const res=run_match(A,B,1.2,0.6,false);
console.log("REGULAR result",res.homeGoals,res.awayGoals,"loglines",res.log.length);
console.log(res.log.filter(l=>l.includes("GOAL!")||l.includes("Assist")).slice(0,3));
// force a tie scenario for playoff by running until a draw
let p:any;
for(let i=0;i<50;i++){
  const A2=buildEngineTeam("Alpha","Balanced",roster("A"));
  const B2=buildEngineTeam("Bravo","Balanced",roster("B"));
  p=run_match(A2,B2,1.2,0.6,true);
  if(p.log.some((l:string)=>l.includes("PENALTY SHOOTOUT"))) break;
}
console.log("PLAYOFF final",p.homeGoals,p.awayGoals,"hasShootout",p.log.some((l:string)=>l.includes("PENALTY SHOOTOUT")));
console.log(p.log.filter((l:string)=>l.includes("WINS THE SHOOTOUT")));
