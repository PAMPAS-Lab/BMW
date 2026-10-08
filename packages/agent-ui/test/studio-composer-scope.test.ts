import assert from 'node:assert/strict'
import test from 'node:test'
import {StudioComposerScope} from '../src/renderer/studio-composer-scope.js'
import type {AssistantState} from '../../agent-contract/index.js'
class Element extends EventTarget{value='';hidden=false;textContent='';onclick:(()=>void)|null=null;children:Element[]=[];focus(){}showModal(){}close(){}replaceChildren(){this.children=[]}append(child:Element){this.children.push(child)}}
test('Composer pins a visual piece at first input, preserves owner drafts and clears piece identity for broader scopes',()=>{
 const original=globalThis.document,elements=new Map<string,Element>(),get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!}
 globalThis.document={getElementById:get,createElement:()=>new Element()} as unknown as Document
 try{
  const input=new Element();let state={project:{id:'p'},selectedSessionId:'s'} as unknown as AssistantState
  const scope=new StudioComposerScope(input as unknown as HTMLTextAreaElement,()=>state);scope.ownerChanged(state)
  const context=(id:string)=>scope.context({projectId:'p',sessionId:'s',mode:'studio',draftTitle:'视频',sceneTitle:'镜头',selection:{draftId:'d',sceneId:'scene',objectKind:'visual',visualSegmentId:id},object:{title:'画面片段 '+id}})
  context('right_piece');input.value='只改右画面';input.dispatchEvent(new Event('input'));const target=structuredClone(scope.target()),label=get('studio-scope').textContent
  assert.equal(target!.kind,'object');assert.equal(target!.visualSegmentId,'right_piece');assert.match(label,/画面片段 right_piece.*已固定/)
  context('left-piece');assert.deepEqual(scope.target(),target);assert.equal(get('studio-scope').textContent,label)
  assert.equal(scope.prefill({target:{...target,visualSegmentId:'left-piece'}}),false);assert.equal(input.value,'只改右画面')
  state={project:{id:'p'},selectedSessionId:'other'} as unknown as AssistantState;scope.ownerChanged(state);assert.equal(input.value,'');assert.equal(scope.target(),undefined)
  state={project:{id:'p'},selectedSessionId:'s'} as unknown as AssistantState;scope.ownerChanged(state);assert.equal(input.value,'只改右画面');assert.deepEqual(scope.target(),target)
  context('left-piece');get('studio-scope').onclick!();get('studio-scope-choices').children[1].onclick!();assert.equal(scope.target()!.kind,'scene');assert.equal(scope.target()!.visualSegmentId,undefined)
  get('studio-scope').onclick!();get('studio-scope-choices').children[0].onclick!();assert.equal(scope.target()!.kind,'film');assert.equal(scope.target()!.sceneId,undefined);assert.equal(scope.target()!.visualSegmentId,undefined)
  input.value='';input.dispatchEvent(new Event('input'));assert.equal(scope.target()!.visualSegmentId,'left-piece')
  scope.context({projectId:'foreign',sessionId:'s',mode:'studio',selection:{draftId:'foreign'}});assert.equal(scope.target()!.draftId,'d')
 }finally{if(original)globalThis.document=original;else Reflect.deleteProperty(globalThis,'document')}
})
