/* Small teaching engine. Iterative alpha-beta search, never presented as a rated human. */
const DoctorSearch=(()=>{
 const E=typeof module!=='undefined'?require('./engine.js'):{color,legal,apply,check},values={p:100,n:320,b:335,r:500,q:900,k:0};
 function evaluate(s){let score=0;for(let i=0;i<64;i++){const p=s.b[i];if(!p)continue;const t=p.toLowerCase(),white=E.color(p)==='w',r=white?7-Math.floor(i/8):Math.floor(i/8),c=i%8,center=3.5-Math.abs(c-3.5)+3.5-Math.abs(r-3.5);let bonus=t==='p'?r*7+center*3:t==='n'?center*12:t==='b'?center*6:t==='k'?(r<2?8:-center*5):center*2;score+=(white?1:-1)*(values[t]+bonus)}return score}
 function moveList(s){let out=[];for(let i=0;i<64;i++)if(E.color(s.b[i])===s.turn)for(const j of E.legal(s,i)){const promotions=s.b[i].toLowerCase()==='p'&&(j<8||j>=56)?['q','n','r','b']:['q'];for(const promotion of promotions)out.push({from:i,to:j,promotion,order:(values[s.b[j]?.toLowerCase()]||0)*10-(s.b[j]?values[s.b[i].toLowerCase()]:0)+(s.b[i].toLowerCase()==='p'&&(j<8||j>=56)?800:0)})}return out.sort((a,b)=>b.order-a.order)}
 function search(state,{level=2,budgetMs=900,maxDepth}={}){
  const start=Date.now(),deadline=start+Math.max(25,budgetMs),root=moveList(state);let nodes=0,completedDepth=0,aborted=false,chosen=root[0]||null,bestScore=0,ranked=[];
  function negamax(s,depth,alpha,beta,ply){nodes++;if(Date.now()>deadline){aborted=true;throw Error('time')}const moves=moveList(s);if(!moves.length)return E.check(s,s.turn)?-100000+ply:0;if(s.half>=100)return 0;if(depth===0)return evaluate(s)*(s.turn==='w'?1:-1);let best=-Infinity;for(const m of moves){const score=-negamax(E.apply(s,m.from,m.to,m.promotion),depth-1,-beta,-alpha,ply+1);if(score>best)best=score;if(score>alpha)alpha=score;if(alpha>=beta)break}return best}
  const limit=maxDepth||[1,2,3][Math.max(0,Math.min(2,level-1))];
  for(let depth=1;depth<=limit;depth++){let iteration=[];try{for(const m of root){const score=-negamax(E.apply(state,m.from,m.to,m.promotion),depth-1,-Infinity,Infinity,1);iteration.push({...m,score})}}catch{break}iteration.sort((a,b)=>b.score-a.score);ranked=iteration;chosen=iteration[0];bestScore=chosen?.score||0;completedDepth=depth;root.sort((a,b)=>(iteration.find(m=>m.from===b.from&&m.to===b.to&&m.promotion===b.promotion)?.score||0)-(iteration.find(m=>m.from===a.from&&m.to===a.to&&m.promotion===a.promotion)?.score||0))}
  if(level===1&&ranked.length&&bestScore<90000){const friendly=ranked.filter(m=>m.score>=bestScore-100).slice(0,4);chosen=friendly[Math.floor(Math.random()*friendly.length)]||chosen;bestScore=chosen.score}
  return {move:chosen?{from:chosen.from,to:chosen.to,promotion:chosen.promotion}:null,score:bestScore*(state.turn==='w'?1:-1),depth:completedDepth,nodes,elapsedMs:Date.now()-start,aborted};
 }
 return {search,evaluate,moveList};
})();
if(typeof module!=='undefined')module.exports=DoctorSearch;
