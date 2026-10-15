import {scriptSentences,assertSentenceAnchors} from './studio-speech-contract.js'
/** Deterministic editorial estimate on a measured voice duration, never ASR. */
export function editorialSentenceAnchors(script:string,durationSeconds:number){
 const sentences=scriptSentences(script)
 if(!sentences.length||sentences.some(s=>s.scriptEnd-s.scriptStart>200)||sentences.length>100)throw new Error('STUDIO_SENTENCE_LENGTH: Split long script sentences before estimating.')
 const weights=sentences.map(s=>Array.from(s.text).length),total=weights.reduce((a,b)=>a+b,0);let used=0
 return assertSentenceAnchors(sentences.map((s,i)=>{const startSeconds=durationSeconds*used/total;used+=weights[i];return {id:s.id,scriptStart:s.scriptStart,scriptEnd:s.scriptEnd,startSeconds,endSeconds:i===sentences.length-1?durationSeconds:durationSeconds*used/total}}),script,durationSeconds)
}
