import {publicationInterval} from './collection-batch-screening.js'
/** Browser-safe display and scheduling policy. Never use a later video upload date. */
export function watchFresh(w:{publishedAt:string},now:number):boolean {
 const interval=publicationInterval(w.publishedAt)
 return Boolean(interval&&interval[0]>=now-72*3600000&&interval[1]<=now)
}
export function watchExpired(w:{publishedAt:string},now:number):boolean {
 const interval=publicationInterval(w.publishedAt)
 return Boolean(interval&&interval[1]<now-72*3600000)
}
