export interface PromptAssembly {contexts?:{name:string;text:string}[];[key:string]:unknown}
export function appendWorkspaceContext(assembly:PromptAssembly,text:unknown):PromptAssembly {
  if(typeof text!=='string'||text.length>16_384)throw new Error('Invalid BMW context snapshot')
  return text?{...assembly,contexts:[...(assembly.contexts??[]).filter(item=>item.name!=='bmw:video-workspace'),{name:'bmw:video-workspace',text}]}:assembly
}
