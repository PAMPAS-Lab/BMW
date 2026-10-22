import {LibraryStorage} from './library-storage.js'
import {assertCollectionSchedule} from './collection-schedule-contract.js'
import type {CollectionScheduleState} from './collection-schedule-contract.js'
/** Separate bounded control state. Evidence/run history remains in immutable rolling shards. */
export class CollectionScheduleStore {
 private storage:LibraryStorage
 constructor(directory:string){this.storage=new LibraryStorage(directory)}
 read():CollectionScheduleState{const raw=this.storage.readJson('library/collection-schedules.json');return raw===undefined?{version:1,revision:0,plans:[],notices:[]}:assertCollectionSchedule(raw)}
 write(state:CollectionScheduleState):CollectionScheduleState{if(this.read().revision!==state.revision)throw new Error('COLLECTION_SCHEDULE_CONFLICT: Reload collection schedules.');const next=assertCollectionSchedule({...state,revision:state.revision+1});this.storage.writeJson('library/collection-schedules.json',next);return next}
}
