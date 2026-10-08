import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {videoDocumentSchema,videoDocumentFromDraft} from '../packages/feature-video/src/video-document.js'
import {videoEditSchema} from '../packages/feature-video/src/video-edit.js'
import {assertVideoDraft,newStudioScene} from '../packages/feature-video/src/studio-contract.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'docs','schemas')
const draft=assertVideoDraft({version:1,id:'example-video',ownerSessionId:'example-session',revision:1,title:'产品介绍',width:1280,height:720,fps:24,music:false,scenes:[{...newStudioScene('opening'),narration:'用真实操作展示产品价值。',durationSeconds:8}],preparation:{notes:'面向首次使用者，简洁地展示核心操作。',outline:'问题 → 操作 → 结果',artifactIds:[]},updatedAt:'2026-10-08T00:00:00.000Z',exports:[]})
const advanced=assertVideoDraft({...draft,layers:[{id:'example-overlay',kind:'text',title:'独立标题',text:'可编辑图层',startSeconds:0,durationSeconds:8,x:.1,y:.1,width:.8,height:.15,opacity:1,zIndex:0,hidden:false,locked:false,color:'#ffffff',fontSize:32,fadeInSeconds:0,fadeOutSeconds:0}]})
const files:Record<string,unknown>={'video-document-v2.schema.json':videoDocumentSchema,'video-edit-v1.schema.json':videoEditSchema,'video-document-example.json':videoDocumentFromDraft(draft),'video-document-advanced-example.json':videoDocumentFromDraft(advanced),'video-edit-example.json':{version:1,commands:[{op:'scene.set',sceneId:'opening',patch:{script:'新的旁白。'}}]}}
const write=process.argv.includes('--write')
if(write)fs.mkdirSync(directory,{recursive:true})
for(const [name,value]of Object.entries(files)){const encoded=JSON.stringify(value,null,2)+'\n',file=path.join(directory,name);if(write)fs.writeFileSync(file,encoded);else if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==encoded)throw new Error('Video schema publication is stale: '+name+'; run npm run docs:video-schema.')}
console.log(write?'Published supported video schemas and examples.':'Video schemas and examples match runtime codecs.')
