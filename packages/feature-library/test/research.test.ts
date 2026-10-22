import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {Ajv} from 'ajv'
import {LibraryService} from '../src/library-service.js'
import {ResearchService} from '../src/research-service.js'
import {ProjectResearchStore,DirectionStore} from '../src/research-store.js'
import {assertResearchRequest,researchRequestSchema} from '../src/research-contract.js'
import type {ProjectTopic,LibraryDirection} from '../src/research-contract.js'
import type {LibraryPage} from '../src/library-contract.js'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'

function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-library-research-'))),profile=path.join(root,'profile');fs.mkdirSync(profile)
 const projects=['one','two','archive'].map(id=>{const directory=path.join(root,id);fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'artifacts'));return {id,name:id,directory,...(id==='archive'?{archivedAt:'2026-10-01'}:{})}}),sources=new Map(projects.map(p=>[p.id,new ProjectSourceStore(p.directory,p.id)])),directions=new DirectionStore(profile)
 let active=projects[0]
 const library=new LibraryService({projects:archived=>projects.filter(p=>archived||!p.archivedAt),active:()=>active,sources:id=>sources.get(id)!,directions:()=>directions.read(),guard:()=>{}}),service=new ResearchService(library,directions)
 for(const project of projects)for(const id of ['original.txt','video-legacy.mp4','final.txt'])fs.writeFileSync(path.join(project.directory,'artifacts',id),'immutable fixture '+project.id+' '+id)
 return {root,profile,projects,sources,library,service,directions,setActive:(id:string)=>{active=projects.find(p=>p.id===id)!},store:(id='one')=>new ProjectResearchStore(projects.find(p=>p.id===id)!.directory,id),close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
const topic={title:'AI 与养老',description:'隐私与陪伴的变化',tags:['AI','养老'],status:'open'}
const direction={title:'长期 AI 与养老',description:'研究原文和采访',tags:['AI'],collectionProjectId:'two',status:'following'}
const material={projectId:'one',artifactId:'original.txt'},work={projectId:'two',artifactId:'final.txt'}
const digest=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

test('Project topics and global promotion persist without moving originals or rewriting legacy news/drafts',async()=>{const f=fixture();try{
 const project=f.projects[0],news=path.join(project.directory,'video-studio','news');fs.mkdirSync(news,{recursive:true});const preserved=[path.join(news,'legacy.json'),path.join(project.directory,'video-studio','old-draft.json'),path.join(project.directory,'artifacts','original.txt'),path.join(project.directory,'artifacts','video-legacy.mp4')];for(const file of preserved.slice(0,2))fs.writeFileSync(file,'{"keep":"legacy"}');const hashes=preserved.map(digest)
 const created=await f.service.execute({operation:'put-topic',expectedRevision:0,topic},'user') as {topic:ProjectTopic;revision:number}
 const promoted=await f.service.execute({operation:'promote',topicId:created.topic.id,expectedTopicRevision:1,expectedRevision:0,direction},'user') as {direction:LibraryDirection;revision:number}
 assert.equal(promoted.direction.collectionProjectId,'two');assert.deepEqual(promoted.direction.topics,[{projectId:'one',topicId:created.topic.id}]);assert.equal(new DirectionStore(f.profile).read().revision,1)
 await f.service.execute({operation:'assign',identity:material,expectedRevision:1,purpose:'source',topicIds:[created.topic.id],directionIds:[]},'user')
 f.setActive('two');const result=await f.library.execute({operation:'search',directionId:promoted.direction.id},'agent') as LibraryPage;assert.equal(result.total,1);assert.equal(result.items[0].projectId,'one')
 await assert.rejects(f.library.execute({operation:'read',...material},'agent'),/COPY_REQUIRED/)
 const restarted=new ProjectResearchStore(project.directory,'one').read();assert.equal(restarted.topics[0].id,created.topic.id);assert.equal(restarted.assignments.length,1);assert.deepEqual(preserved.map(digest),hashes)
 await assert.rejects(f.service.execute({operation:'put-topic',expectedRevision:0,topic},'agent'),/USER_REQUIRED/)
 await assert.rejects(f.service.execute({operation:'put-direction',expectedRevision:1,direction},'agent'),/USER_REQUIRED/)
}finally{f.close()}})

test('Explicit purpose supports non-video works and reference/planned relations never claim actual adoption',async()=>{const f=fixture();try{
 assert.equal((await f.library.execute({operation:'search',purpose:'work'},'user') as LibraryPage).total,0,'A legacy MP4 filename is not proof of a finished work')
 await f.service.execute({operation:'assign',identity:work,expectedRevision:0,purpose:'work',topicIds:[],directionIds:[]},'user')
 const works=await f.library.execute({operation:'search',purpose:'work'},'user') as LibraryPage;assert.equal(works.total,1);assert.equal(works.items[0].kind,'text');assert.equal(works.items[0].projectId,'two')
 const relation=await f.service.execute({operation:'relate',from:material,to:work,type:'reference',note:'参考但尚未采用',expectedRevision:0},'user') as {relation:{id:string}}
 const inbound=await f.service.execute({operation:'links',identity:work},'agent') as {items:{type:string}[]};assert.equal(inbound.items[0].type,'reference')
 await f.service.execute({operation:'remove-relation',projectId:'one',id:relation.relation.id,expectedRevision:1},'user');assert.equal(f.store().read().relations.length,0)
 await assert.rejects(f.service.execute({operation:'relate',from:material,to:work,type:'used',expectedRevision:2},'user'),/reference\/planned/)
 await assert.rejects(f.service.execute({operation:'assign',identity:{projectId:'archive',artifactId:'final.txt'},expectedRevision:0,purpose:'work',topicIds:[],directionIds:[]},'user'),/read-only/)
}finally{f.close()}})

test('CAS rejects stale organization, promotion and global direction edits without partially changing either store',async()=>{const f=fixture();try{
 const created=await f.service.execute({operation:'put-topic',expectedRevision:0,topic},'user') as {topic:ProjectTopic}
 await assert.rejects(f.service.execute({operation:'put-topic',id:created.topic.id,expectedRevision:0,topic:{...topic,title:'stale'}},'user'),/CONFLICT/)
 await assert.rejects(f.service.execute({operation:'promote',topicId:created.topic.id,expectedTopicRevision:0,expectedRevision:0,direction},'user'),/CONFLICT/);assert.equal(f.directions.read().directions.length,0)
 await f.service.execute({operation:'put-direction',expectedRevision:0,direction},'user');const before=f.store().read()
 await assert.rejects(f.service.execute({operation:'promote',topicId:created.topic.id,expectedTopicRevision:1,expectedRevision:0,direction},'user'),/CONFLICT/);assert.deepEqual(f.store().read(),before);assert.equal(f.directions.read().directions.length,1)
 await assert.rejects(f.service.execute({operation:'assign',identity:material,purpose:'work',topicIds:['foreign'],directionIds:[],expectedRevision:1},'user'),/foreign/)
 await assert.rejects(f.service.execute({operation:'assign',identity:material,purpose:'source',topicIds:[],directionIds:['missing'],expectedRevision:1},'user'),/Unknown/)
}finally{f.close()}})

test('Corrupt and linked research metadata is preserved; raw material discovery remains available with explicit issues',async()=>{const f=fixture();try{
 const directory=path.join(f.projects[0].directory,'library');fs.mkdirSync(directory);const file=path.join(directory,'research.json');fs.writeFileSync(file,'{"broken":');const before=fs.readFileSync(file)
 assert.throws(()=>f.store().read());await assert.rejects(f.service.execute({operation:'put-topic',expectedRevision:0,topic},'user'));assert.deepEqual(fs.readFileSync(file),before)
 const found=await f.library.execute({operation:'search',projectId:'one'},'user') as LibraryPage;assert.equal(found.total,3);assert.ok(found.issues.some(i=>i.message.includes('专题关联')))
 fs.unlinkSync(file);fs.symlinkSync(path.join(f.projects[0].directory,'artifacts','original.txt'),file);assert.throws(()=>f.store().read(),/symbolic/i)
 const global=path.join(f.profile,'library');fs.mkdirSync(global);const globalFile=path.join(global,'directions.json');fs.writeFileSync(globalFile,'{"version":9}');const original=fs.readFileSync(globalFile);await assert.rejects(f.service.execute({operation:'put-direction',expectedRevision:0,direction},'user'));assert.deepEqual(fs.readFileSync(globalFile),original)
}finally{f.close()}})

test('Closed browser schema matches parser and refuses paths, ambiguous identities, oversized pages and adoption claims',()=>{
 const validate=new Ajv({strict:false}).compile(researchRequestSchema)
 const valid=[{operation:'topics'},{operation:'directions',offset:30,limit:20},{operation:'direction-topics',directionId:'direction',offset:20},{operation:'put-topic',expectedRevision:0,topic},{operation:'put-direction',expectedRevision:0,direction},{operation:'assign',identity:material,expectedRevision:0,purpose:'work',topicIds:[],directionIds:[]},{operation:'links',identity:work}]
 for(const r of valid){assert.equal(validate(r),true,JSON.stringify(validate.errors));assert.doesNotThrow(()=>assertResearchRequest(r))}
 for(const r of [{operation:'topics',path:'/etc/passwd'},{operation:'directions',limit:51},{operation:'links',identity:{...material,sourceId:'source'}},{operation:'relate',from:material,to:work,type:'used',expectedRevision:0},{operation:'assign',identity:{projectId:'one',artifactId:'../secret'},expectedRevision:0,purpose:'work',topicIds:[],directionIds:[]}])assert.throws(()=>assertResearchRequest(r))
})

test('Direction topic references paginate beyond summary limits, unlink safely and expose archived collection state',async()=>{const f=fixture();try{
 const state=f.store().read(),now=new Date().toISOString(),topics=Array.from({length:25},(_,i)=>({...topic,status:'open' as const,id:'topic-'+i,createdAt:now,updatedAt:now}));f.store().write(0,{...state,topics})
 f.directions.write(0,{version:1,revision:0,directions:[{...direction,status:'following',id:'direction',topics:topics.map(t=>({projectId:'one',topicId:t.id})),createdAt:now,updatedAt:now}]})
 const summary=await f.service.execute({operation:'directions'},'agent') as {items:{topics:unknown[];topicCount:number}[]};assert.equal(summary.items[0].topics.length,20);assert.equal(summary.items[0].topicCount,25)
 const page=await f.service.execute({operation:'direction-topics',directionId:'direction',offset:20,limit:20},'agent') as {items:{topicId:string}[];total:number;nextOffset:null};assert.equal(page.items.length,5);assert.equal(page.items[4].topicId,'topic-24');assert.equal(page.nextOffset,null)
 await f.service.execute({operation:'link-topic',directionId:'direction',topicProjectId:'one',topicId:'topic-24',linked:false,expectedRevision:1},'user');assert.equal(f.directions.read().directions[0].topics.length,24);assert.equal(f.store().read().topics.length,25)
 f.projects[1].archivedAt='2026-10-21';const archived=await f.service.execute({operation:'directions'},'agent') as {items:{collectionState:string}[]};assert.equal(archived.items[0].collectionState,'archived')
 const abort=new AbortController();abort.abort();const before=f.directions.read();await assert.rejects(f.service.execute({operation:'put-direction',expectedRevision:2,direction},'user',abort.signal));assert.deepEqual(f.directions.read(),before)
}finally{f.close()}})

test('Acquisition grouping reaches its saved original without duplicating files and an explicit artifact assignment can override it',async()=>{const f=fixture();try{
 const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const},saved=await f.sources.get('one')!.collect({url:'https://example.org/original',title:'Original research',author:'Institution',publishedAt:'2026-10-20',scope,text:'An original statement, saved once.',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null},0)
 const created=await f.service.execute({operation:'put-topic',expectedRevision:0,topic},'user') as {topic:ProjectTopic},source={projectId:'one',sourceId:saved.sourceId,acquisitionId:saved.acquisitionId},artifact={projectId:'one',artifactId:saved.catalog.sources[0].acquisitions[0].originalTextArtifactId!}
 await f.service.execute({operation:'assign',identity:source,purpose:'source',topicIds:[created.topic.id],directionIds:[],expectedRevision:1},'user')
 const grouped=await f.library.execute({operation:'search',topicId:created.topic.id},'user') as LibraryPage;assert.ok(grouped.items.some(i=>i.artifactId===artifact.artifactId));assert.ok(grouped.items.some(i=>i.sourceId===source.sourceId))
 const links=await f.service.execute({operation:'links',identity:artifact},'agent') as {assignment:{topicIds:string[];purpose:string}};assert.deepEqual(links.assignment.topicIds,[created.topic.id]);assert.equal(links.assignment.purpose,'unclassified')
 await f.service.execute({operation:'assign',identity:artifact,purpose:'derived',topicIds:[],directionIds:[],expectedRevision:2},'user');assert.equal((await f.library.execute({operation:'search',topicId:created.topic.id,kind:'text'},'user') as LibraryPage).total,0)
 assert.equal(f.sources.get('one')!.snapshot().revision,1,'Grouping never modifies the source evidence catalog')
}finally{f.close()}})
