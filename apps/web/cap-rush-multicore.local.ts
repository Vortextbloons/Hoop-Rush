import { CapRushRunner } from './src/lib/features/cap-rush/cap-rush-runner.ts';
import { capRushPlayoffGameSeed } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  POSITIONS,
  capRushCardSchema,
  type CapRushLeagueGame,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
  capRushNextLeagueSlot,
  createEngineContext,
  simulateCapRushLeagueSlot,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';

function lockedRun() {
  const setup = capRushTestSetup();
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'clash',
    versionSet: setup.versionSet,
    catalog: setup.source,
    spin: null,
    picks: POSITIONS.map((slot, index) => ({
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: setup.index.bySlot.get(slot)?.[0],
        salaryDollars: 30_000_000,
      }),
    })),
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover: {
      franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
      games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
    },
  });
}


const locked=lockedRun();
const games=Array.from({length:8},(_,i)=>({seriesId:`crs-1-${i}`,round:1,seriesSlot:i,gameOrdinal:1,homeTeamId:locked.opponents[i*2]!.team.teamId,awayTeamId:locked.opponents[i*2+1]!.team.teamId,homeSeed:1,awaySeed:8,userSide:null,isFinals:false,seed:capRushPlayoffGameSeed(locked.runSeed,1,i,1)}));
const runners=[1,2].map(parallelism=>new CapRushRunner({parallelism,createWorker:()=>new Worker(new URL('./src/workers/cap-rush-worker.ts',import.meta.url).href)}));
const measurements:any={season:{serial:[],parallel:[]},slot:{serial:[],parallel:[]},playoffs:{serial:[],parallel:[]}};
let id=0;
try {
 for(const workload of ['season','slot','playoffs'] as const) {
  for(let iteration=0;iteration<7;iteration++) {
   const outputs=[];
   for(const lane of (iteration%2?[1,0]:[0,1])) {
    const runner=runners[lane]!;const messages:any[]=[];const start=performance.now();
    const result=workload==='playoffs'?await runner.simulatePlayoffs({requestId:`req-${++id}`,locked,games,handlers:{onGame:m=>{messages.push(m.game);}}}):await runner.simulate({requestId:`req-${++id}`,locked,startGame:1,count:workload==='season'?82:1,handlers:{onGame:m=>{messages.push({summary:m.summary,result:m.result,leagueGames:m.leagueGames});}}});
    if(iteration>1)measurements[workload][lane?'parallel':'serial'].push(performance.now()-start);
    outputs.push(JSON.stringify(messages));
    if(result.cancelled)throw new Error('unexpected cancellation');
   }
   if(outputs[0]!==outputs[1])throw new Error(`${workload} results differ`);
  }
 }
 console.log(JSON.stringify({measurements,medians:Object.fromEntries(Object.entries(measurements).map(([workload,data]:any)=>[workload,Object.fromEntries(Object.entries(data).map(([name,samples]:any)=>[name,[...samples].sort((a,b)=>a-b)[2]]))])),identical:true}));
}finally{runners.forEach(r=>r.destroy());}
