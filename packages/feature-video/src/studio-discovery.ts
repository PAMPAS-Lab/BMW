import type {StudioRequest} from './studio-contract.js'
import type {BrowserHelpQuery,JsonSchema} from '../../browser-capability/src/browser-schema.js'
import {sourceOperationContracts,sourceRequestSchema} from '../../media-native/src/source-contract.js'
import {materialIndexRequestSchema} from './material-index-contract.js'
import {newsPreparationRequestSchema} from './news-preparation-contract.js'
type Spec={required:readonly string[];optional:readonly string[]}
const spec=(required:readonly string[]=[],optional:readonly string[]=[]):Spec=>({required,optional})
const draft=['draftId','expectedRevision'],scene=[...draft,'sceneId'],paging=['pageOffset','pageLimit']
/** Field ownership is shared by discovery and admission; feature code owns all operations. */
export const studioOperationContracts={
 'news-preparation':spec([...draft,'preparationRequest'],paging),
 'news-topics':spec(), 'propose-news-topics':spec(['expectedTopicRevision','newsCandidates'],['closeNewsTask']), 'select-news-topic':spec(['expectedTopicRevision','topicId','baseFingerprint'],['options']), 'news-guide':spec(draft),
 'record-production-review':spec([...draft,'baseFingerprint','expectedAssessmentRevision','assessment']), 'precomposition-status':spec([...draft,'artifactId']), precompose:spec([...draft,'gridRecipe']), 'production-profiles':spec(), 'propose-type':spec([...draft,'productionType'],['recipeId','sceneId']), 'adopt-type':spec([...draft,'productionType','baseFingerprint'],['recipeId','sceneId']), 'production-read':spec(draft,['productionSection',...paging]), 'production-review':spec(draft), 'plan-impact':spec(draft,['edit','cover','baseFingerprint',...paging]),
 analysis:spec([...draft,'analysisRequest']),
 guide:spec(),'describe-schema':spec(),'describe-edit':spec([],['editOperation','editOperations']),'describe-template':spec(['cardTemplateId']),
 context:spec(),open:spec(),list:spec([],paging),assets:spec([],['assetQuery']),
 source:spec(['sourceRequest'],[...paging,'sourceSection']),materials:spec(['materialRequest']),
 create:spec([],['title','options','templateName']),read:spec(['draftId'],paging),
 'read-material':spec(['artifactId'],paging),'read-scene':spec(scene,['section',...paging]),'read-preparation':spec(draft,['briefSection',...paging]),
 'read-document':spec(draft),compatibility:spec(draft),'migrate-document':spec(draft),'validate-edit':spec([...draft,'edit']),'apply-edit':spec([...draft,'edit']),
 update:spec([...draft,'draft']),delete:spec(draft),restore:spec([...draft,'draft','snapshotProof']),
 'review-status':spec(draft,paging),'record-export-review':spec([...draft,'exportReview'],['sceneId']),
 'review-export':spec(scene,['reviewOffset']),'export-citations':spec(draft),'export-cover':spec(draft,['cover']),'export-captions':spec([...draft,'captionFormat']),
 'prepare-reference':spec([...draft,'artifactId','assetKind'],['timestampsSeconds']),'read-reference':spec([...draft,'referenceId']),
 'set-reference-analyses':spec([...draft,'referenceAnalyses']),
 'remove-reference':spec([...draft,'referenceId']),'set-reference-analysis':spec([...draft,'referenceId','referenceAnalysis']),
 'apply-reference-notes':spec([...draft,'referenceId','beforeNotes']),
 'propose-review':spec([...draft,'reviewProposal']),'adopt-review':spec([...draft,'reviewId']),'dismiss-review':spec([...draft,'reviewId']),'undo-review':spec([...draft,'reviewId']),
 'split-scene':spec([...scene,'splitSeconds']),
 'diagnose-timing':spec(scene,['timingSection',...paging]),'suggest-recording-plan':spec(scene),
 'apply-recording-plan':spec([...scene,'recordingPlan','recordingSourceSha256','recordingEventsSha256']),
 'apply-source-narration':spec([...scene,'sourceNarrationRecipe']),'validate-source-narration':spec([...scene,'sourceNarrationRecipe']),
 'estimate-speech':spec(scene,paging),'read-speech':spec(scene,paging),'align-speech':spec(scene,['speechModel']),
 'correct-speech':spec(scene,['anchors','cardLinks','timingBasis']),
 'recognize-source':spec(scene,['segmentIndex','speechModel','speechLanguage','sourceRange']),'read-source-speech':spec(scene,paging),
 'apply-source-captions':spec([...scene,'sourceCues']),'detach-source-captions':spec(scene),'set-caption-translations':spec([...scene,'translations']),
 'suggest-focus':spec(scene,['segmentIndex']),inspect:spec(['artifactId'],['assetKind']),
 narrate:spec(scene,['provider','voice','ratePercent','templateName']),'narrate-local':spec(scene),'narrate-pending':spec(draft),
 check:spec(draft),render:spec(draft,['forceRender']),attach:spec([...scene,'artifactId','assetKind'],['segmentIndex']),
 configure:spec(draft,['options','templateName']),'save-template':spec([...draft,'templateName'])
} satisfies Record<StudioRequest['operation'],Spec>
export function studioOperationSpec(value:unknown):Spec|undefined{return typeof value==='string'&&Object.hasOwn(studioOperationContracts,value)?studioOperationContracts[value as keyof typeof studioOperationContracts]:undefined}
export function studioRecovery(raw:unknown,error:unknown):TypeError {
 const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{},operation=studioOperationSpec(value.operation)?String(value.operation):undefined
 const nested=value.sourceRequest&&typeof value.sourceRequest==='object'?value.sourceRequest as Record<string,unknown>:{},sub=operation==='source'&&typeof nested.operation==='string'&&Object.hasOwn(sourceOperationContracts,nested.operation)?nested.operation as keyof typeof sourceOperationContracts:undefined
 const contract=sub?sourceOperationContracts[sub]:operation?studioOperationSpec(operation):undefined
 return new TypeError(JSON.stringify({code:'BMW_STUDIO_ARGUMENTS_INVALID',stage:'validation',executed:false,message:error instanceof Error?error.message:'Invalid Studio request.',...(contract?{requiredFields:['operation',...contract.required],acceptedFields:['operation',...contract.required,...contract.optional]}:{}),...(operation==='source'?{supportedSubOperations:Object.keys(sourceOperationContracts)}:{supportedOperations:Object.keys(studioOperationContracts)}),...(operation==='context'?{correctedRequest:{action:'video.studio',studioRequest:{operation:'context'}},correction:'Context is scoped to the current Project and Session. Omit draftId, expectedRevision and all other fields; submit correctedRequest explicitly.'}:{}),recovery:{action:'help',forAction:'video.studio',...(operation?{forOperation:operation}:{}),...(sub?{forSubOperation:sub}:{})}}))
}
export function studioHelp(schema:JsonSchema,query:BrowserHelpQuery):unknown {
 const operation=query.forOperation,operationSpec=studioOperationSpec(operation)
 if(operation!==undefined&&!operationSpec||query.forSubOperation!==undefined&&operation!=='source'&&operation!=='materials'&&operation!=='news-preparation')throw studioRecovery({operation},new TypeError('Unknown Studio help operation.'))
 if(operation==='materials'||operation==='news-preparation'){
  const branches=operation==='materials'?materialIndexRequestSchema.oneOf:newsPreparationRequestSchema.oneOf,subOperations=branches.map(branch=>(branch.properties.operation as {const:string}).const),sub=query.forSubOperation,field=operation==='materials'?'materialRequest':'preparationRequest'
  const binding=operation==='news-preparation'?{draftId:rootDraftId(schema),expectedRevision:{type:'integer',minimum:1,maximum:1000000}}:{}
  const inputSchema=(branch:JsonSchema)=>({type:'object',additionalProperties:false,required:['action','studioRequest'],properties:{action:{const:'video.studio'},studioRequest:{type:'object',additionalProperties:false,required:['operation',...Object.keys(binding),field],properties:{operation:{const:operation},...binding,[field]:branch}}}})
  if(sub===undefined)return {action:'video.studio',operation,subOperations,...(operation==='news-preparation'?{inputSchema:inputSchema({oneOf:branches.filter(branch=>['read','preflight'].includes((branch.properties.operation as {const:string}).const))}),schemaSubOperations:['read','preflight'],schemaCoverage:'Read-only read/preflight requests are complete here. Select forSubOperation for any mutation; no mutation schema is implied.'}:{}),next:{action:'help',forAction:'video.studio',forOperation:operation,forSubOperation:operation==='materials'?'index':'record-scenes'}}
  const branch=branches.find(branch=>(branch.properties.operation as {const:string}).const===sub)
  if(!branch)throw studioRecovery({operation},new TypeError('Unknown '+operation+' operation. Supported: '+subOperations.join(', ')))
  return {action:'video.studio',operation,subOperation:sub,inputSchema:inputSchema(branch),subOperations}
 }

 const rootProperties=schema.properties as Record<string,JsonSchema>
 const sub=query.forSubOperation
 if(sub!==undefined&&!Object.hasOwn(sourceOperationContracts,sub))throw studioRecovery({operation:'source'},new TypeError('Unknown source operation; choose an exact supportedSubOperations value.'))
 const selected=sub?sourceOperationContracts[sub as keyof typeof sourceOperationContracts]:operationSpec
 const fields=selected?['operation',...selected.required,...selected.optional]:['operation']
 const properties=sub?sourceRequestSchema.properties as Record<string,JsonSchema>:rootProperties
 const omitted:string[]=[]
 const selectedProperties=Object.fromEntries(fields.map(key=>{
  let item=properties[key]
  if(key==='operation')item=operation?{const:sub??operation}:{type:'string',enum:Object.keys(studioOperationContracts)}
  if(!sub&&operation==='source'&&key==='sourceRequest'){omitted.push(key);item={type:'object',required:['operation'],additionalProperties:false,properties:{operation:sourceRequestSchema.properties.operation},description:'Select forSubOperation in browser help to get the complete closed sourceRequest fields.'}}
  else if(JSON.stringify(item).length>1500&&!((operation==='propose-news-topics'&&key==='newsCandidates')||(operation==='news-preparation'&&key==='preparationRequest'))){omitted.push(key);item={type:item.type??'object',description:'Nested contract omitted from this projection. Use the feature discovery request in next.'}}
  return [key,item]
 }))
 const requestSchema={type:'object',additionalProperties:false,required:['operation',...(selected?.required??[])],properties:selectedProperties}
 const studioSchema=sub?{type:'object',additionalProperties:false,required:['operation','sourceRequest'],properties:{operation:{const:'source'},sourceRequest:requestSchema}}:requestSchema
 const inputSchema={type:'object',additionalProperties:false,required:['action','studioRequest'],properties:{action:{const:'video.studio'},studioRequest:studioSchema}}
 return {action:'video.studio',...(operation?{operation}:{}),...(sub?{subOperation:sub}:{}),inputSchema,...(!operation?{operations:Object.keys(studioOperationContracts)}:{}),...(operation==='source'&&!sub?{subOperations:Object.keys(sourceOperationContracts),next:{action:'help',forAction:'video.studio',forOperation:'source',forSubOperation:'collect'}}:{next:{action:'video.studio',studioRequest:{operation:omitted.includes('edit')?'describe-schema':'guide'}}}),...(omitted.length?{nestedSchemaProjection:true,omittedFields:omitted}:{}),...(sub==='acquire'?{conditions:['method=capture also requires videoSelector; download rejects capture-only options.']}:{})}
}

function rootDraftId(schema:JsonSchema):JsonSchema{return (schema.properties as Record<string,JsonSchema>).draftId}
