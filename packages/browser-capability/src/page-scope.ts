/** Closed, bounded DOM range; never JavaScript supplied by the caller. */
export interface PageScope {selector:string|null;index:number;excludeSelectors:string[];maxCharacters:number}
export function assertPageScope(value:Record<string,unknown>):PageScope {
  const selector=value.selector===undefined?null:value.selector
  if(selector!==null&&(typeof selector!=='string'||!selector.trim()||selector.length>500))throw new Error('Page selector must contain 1–500 characters.')
  const index=value.index??0
  if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>10000)throw new Error('Invalid page range index.')
  const excludes=value.excludeSelectors??[]
  if(!Array.isArray(excludes)||excludes.length>16||excludes.some(s=>typeof s!=='string'||!s.trim()||s.length>500))throw new Error('At most sixteen bounded exclusion selectors.')
  const max=value.maxCharacters??12000
  if(typeof max!=='number'||!Number.isFinite(max))throw new Error('Invalid page character budget.')
  return {selector:selector as string|null,index,excludeSelectors:excludes as string[],maxCharacters:Math.min(50000,Math.max(1000,Math.floor(max)))}
}
// Runs only inside the sandboxed page, returning a DOM reference to the fixed
// observer script. The reference is omitted from the serialized reply.
function readPageRange(scope:PageScope) {
  const roots=scope.selector?document.querySelectorAll(scope.selector):[document.body]
  const root=roots[scope.index] as Element|undefined
  const exclude=['script','style','template','noscript','input','textarea','select','[contenteditable]:not([contenteditable="false"])','[hidden]','[aria-hidden="true"]',...scope.excludeSelectors].join(',')
  // Validate selectors even for an empty range, so malformed exclusions fail.
  document.querySelector(exclude)
  let text='',visitedNodes=0,truncated=false
  if(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
    while(walker.nextNode()){
      if(++visitedNodes>10000){truncated=true;break}
      const node=walker.currentNode,parent=node.parentElement
      if(!parent||parent.closest(exclude))continue
      const style=getComputedStyle(parent)
      if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||!parent.getClientRects().length)continue
      const value=node.textContent?.trim()
      if(!value)continue
      const next=(text?'\n':'')+value,available=scope.maxCharacters-text.length
      if(next.length>available){text+=next.slice(0,available);truncated=true;break}
      text+=next
    }
  }
  return {root,exclude,text,range:{selector:scope.selector,index:scope.index,matches:roots.length,excludeSelectors:scope.excludeSelectors,extraction:'visible-text-nodes',characterUnit:'utf16',truncated,visitedNodes,status:root?'observed':'element-not-found'}}
}
export function pageRangeExpression(scope:PageScope):string{return `(${readPageRange.toString()})(${JSON.stringify(scope)})`}
