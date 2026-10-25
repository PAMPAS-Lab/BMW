import {assertPageScope} from './page-scope.js'

export interface PageTextFind {selector:string;text:string;offset:number;excludeSelectors:string[]}
export function assertPageTextFind(raw:Record<string,unknown>):PageTextFind {
 const scope=assertPageScope(raw),text=raw.text,offset=raw.findOffset??0
 if(!scope.selector)throw new TypeError('Text finding requires an explicit bounded selector.')
 if(typeof text!=='string'||!text.trim()||text.length>200)throw new TypeError('Find text must contain 1–200 characters.')
 if(typeof offset!=='number'||!Number.isInteger(offset)||offset<0||offset>10000)throw new TypeError('Invalid text find offset.')
 return {selector:scope.selector,text,offset,excludeSelectors:scope.excludeSelectors}
}
/** Fixed read-only renderer code. Results locate originals, never certify them. */
function findVisibleText(query:PageTextFind){
 const roots=document.querySelectorAll(query.selector),exclude=['script','style','template','noscript','input','textarea','select','[contenteditable]:not([contenteditable="false"])','[hidden]','[aria-hidden="true"]',...query.excludeSelectors].join(',')
 document.querySelector(exclude)
 const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase(),needle=normalize(query.text),matches:{selector:string;index:number;text:string;truncated:boolean}[]=[]
 const partialElementIndices:number[]=[];let cursor=query.offset,visitedNodes=0,scanned=0
 while(cursor<roots.length&&cursor<10000&&scanned<200&&matches.length<8&&visitedNodes<20000){
  const index=cursor++,root=roots[index];scanned++
  let text='',truncated=false
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  while(walker.nextNode()){
   if(++visitedNodes>20000){truncated=true;break}
   const node=walker.currentNode,parent=node.parentElement
   if(!parent||parent.closest(exclude))continue
   const style=getComputedStyle(parent)
   if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||!parent.getClientRects().length)continue
   const value=node.textContent?.trim();if(!value)continue
   const next=(text?'\n':'')+value,available=2000-text.length
   if(next.length>available){text+=next.slice(0,available);truncated=true;break}text+=next
  }
  if(truncated)partialElementIndices.push(index)
  if(normalize(text).includes(needle))matches.push({selector:query.selector,index,text:text.slice(0,1000),truncated:truncated||text.length>1000})
 }
 const budgetExhausted=cursor>=10000&&cursor<roots.length
 return {title:document.title,url:location.href,selector:query.selector,matchMode:'case-insensitive-normalized-visible-text',offset:query.offset,scanned,visitedNodes,totalElements:roots.length,matches,nextOffset:cursor<roots.length&&!budgetExhausted?cursor:null,complete:cursor>=roots.length&&!partialElementIndices.length,budgetExhausted,partialElementIndices,scope:'DOM-locators-only; collect and bind the selected original before using as evidence'}
}
export function pageTextFindExpression(query:PageTextFind):string{return `(${findVisibleText.toString()})(${JSON.stringify(query)})`}
