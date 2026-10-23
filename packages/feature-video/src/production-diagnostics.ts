import crypto from 'node:crypto'
export interface ProductionStage {stage:string;elapsedMs:number;status:'completed'|'failed';sceneId?:string;reused?:boolean}
/** Metadata only: no prompts, transcripts, quotes, paths, endpoints or credentials. */
export class ProductionDiagnostics {
 readonly operationId=crypto.randomUUID()
 readonly stages:ProductionStage[]=[]
 private readonly started=performance.now()
 constructor(private owner:{projectId:string;sessionId:string;draftId?:string},readonly operation:string){}
 async stage<T>(stage:string,work:()=>Promise<T>,sceneId?:string,reused=false):Promise<T>{
  const start=performance.now();let status:ProductionStage['status']='failed'
  try{const result=await work();status='completed';return result}finally{const row={stage,elapsedMs:Math.round(performance.now()-start),status,...(sceneId?{sceneId}:{}),...(reused?{reused}:{} )};this.stages.push(row);try{console.info('[BMW production] '+JSON.stringify({version:1,at:new Date().toISOString(),operationId:this.operationId,...this.owner,operation:this.operation,...row}))}catch{/* Diagnostics cannot change native task outcome. */}}
 }
 snapshot(){return {operationId:this.operationId,elapsedMs:Math.round(performance.now()-this.started),stages:this.stages,measurement:'Native operation wall time includes queue/transport; excludes official model time between calls.'}}
}
