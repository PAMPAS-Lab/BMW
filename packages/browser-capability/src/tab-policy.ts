export const MAX_AGENT_TABS_PER_PROJECT = 6
const MAX_SAVED_TABS = 20
export type TabSource = 'user' | 'agent' | 'page'
export interface SavedTab {url:string;source:TabSource}
export interface ProjectTabState {urls:string[];activeUrl:string|null;tabs?:SavedTab[]}
interface PolicyTab {id:string;projectId:string|null;source?:string;url:string;lastUsedAt?:number;createdAt?:number}
const httpUrl=(value:unknown):value is string=>typeof value==='string'&&/^https?:\/\//i.test(value)
const stamp=(tab:PolicyTab)=>Number(tab.lastUsedAt||tab.createdAt||0)

/** Old URL-only state has no ownership evidence: retain those pages as user tabs. */
export function normalizeProjectTabState(raw:unknown):ProjectTabState {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid Project tab state.')
 const value=raw as Record<string,unknown>,activeUrl=httpUrl(value.activeUrl)?value.activeUrl:null
 if(value.urls!==undefined&&!Array.isArray(value.urls))throw new TypeError('Invalid Project tab URLs.')
 const urls=[...new Set((value.urls as unknown[]|undefined??[]).filter(httpUrl))]
 let tabs:SavedTab[]|undefined
 if(value.tabs!==undefined){
  if(!Array.isArray(value.tabs))throw new TypeError('Invalid Project tab ownership.')
  tabs=[]
  for(const rawTab of value.tabs){
   if(!rawTab||typeof rawTab!=='object'||Array.isArray(rawTab))throw new TypeError('Invalid saved tab.')
   const t=rawTab as Record<string,unknown>
   if(Object.keys(t).some(k=>!['url','source'].includes(k))||!httpUrl(t.url)||!['user','agent','page'].includes(String(t.source)))throw new TypeError('Invalid saved tab ownership.')
   const previous=tabs.find(p=>p.url===t.url)
   if(!previous)tabs.push({url:t.url,source:t.source as TabSource})
   else if(previous.source==='agent'&&t.source!=='agent')previous.source=t.source as TabSource
   if(!urls.includes(t.url))urls.push(t.url)
  }
 }
 // Keep the visible page even when the first twenty saved URLs are older.
 if(activeUrl&&!urls.includes(activeUrl))urls.push(activeUrl)
 const bounded=urls.slice(0,MAX_SAVED_TABS)
 if(activeUrl&&!bounded.includes(activeUrl))bounded[bounded.length-1]=activeUrl
 return {urls:bounded,activeUrl,...(tabs?{tabs:bounded.map(url=>tabs!.find(t=>t.url===url)??{url,source:'user' as const})}:{})}
}
export function projectTabsToRestore(raw:unknown):{tabs:SavedTab[];activeUrl:string|null}{
 const state=normalizeProjectTabState(raw??{urls:[],activeUrl:null}),tabs=state.tabs??state.urls.map(url=>({url,source:'user' as const}))
 const agents=tabs.filter(t=>t.source==='agent'),keep=new Set(agents.slice(-MAX_AGENT_TABS_PER_PROJECT).map(t=>t.url))
 if(agents.some(t=>t.url===state.activeUrl)&&!keep.has(state.activeUrl!)){keep.delete(keep.values().next().value!);keep.add(state.activeUrl!)}
 return {tabs:tabs.filter(t=>t.source!=='agent'||keep.has(t.url)),activeUrl:state.activeUrl}
}
export function reusableTab<T extends PolicyTab>(tabs:T[],{projectId,targetUrl,reuse=true}:{projectId:string|null;targetUrl:string;reuse?:boolean}):{tab:T;navigate:boolean;reason:string}|null {
 if(!reuse)return null
 const candidates=tabs.filter(tab=>tab.projectId===projectId),recent=(a:T,b:T)=>stamp(b)-stamp(a),exact=candidates.filter(tab=>tab.url===targetUrl).sort(recent)[0]
 if(exact)return {tab:exact,navigate:false,reason:'exact-url'}
 const origin=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.origin:''}catch{return ''}},targetOrigin=origin(targetUrl)
 if(!targetOrigin)return null
 const agent=candidates.filter(tab=>tab.source==='agent'&&origin(tab.url)===targetOrigin).sort(recent)[0]
 return agent?{tab:agent,navigate:true,reason:'same-origin-agent'}:null
}
export function agentTabsToClose<T extends PolicyTab>(tabs:T[],{projectId,activeTabId,keepTabId,limit=MAX_AGENT_TABS_PER_PROJECT}:{projectId:string|null;activeTabId?:string|null;keepTabId?:string;limit?:number}):T[]{
 const agentTabs=tabs.filter(tab=>tab.projectId===projectId&&tab.source==='agent'),overflow=Math.max(0,agentTabs.length-limit)
 return agentTabs.filter(tab=>tab.id!==activeTabId&&tab.id!==keepTabId).sort((a,b)=>stamp(a)-stamp(b)).slice(0,overflow)
}
