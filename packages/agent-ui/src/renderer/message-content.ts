/** Render a small Markdown subset with DOM text nodes; model HTML never executes. */
function inline(target:HTMLElement,text:string):void{
  const pattern=/\*\*([^*\n]{1,4096})\*\*|`([^`\n]{1,4096})`/g
  let offset=0
  for(const match of text.matchAll(pattern)){
    target.append(document.createTextNode(text.slice(offset,match.index)))
    const node=document.createElement(match[1]!==undefined?'strong':'code')
    node.textContent=match[1]??match[2];target.append(node);offset=match.index!+match[0].length
  }
  target.append(document.createTextNode(text.slice(offset)))
}
export function renderMessageContent(target:HTMLElement,text:string):void{
  const lines=text.split('\n');let index=0
  while(index<lines.length){
    const line=lines[index++]
    if(!line.trim())continue
    if(/^```[\w+-]*\s*$/.test(line)){
      const code=document.createElement('code'),pre=document.createElement('pre'),body:string[]=[]
      while(index<lines.length&&!/^```\s*$/.test(lines[index]))body.push(lines[index++])
      if(index<lines.length)index++
      code.textContent=body.join('\n');pre.append(code);target.append(pre);continue
    }
    const heading=/^#{1,4}\s+(.*)$/.exec(line)
    if(heading){const node=document.createElement('h3');inline(node,heading[1]);target.append(node);continue}
    const list=/^\s*([-*+] |\d+\. )(.*)$/.exec(line)
    if(list){
      const ordered=/^\d/.test(list[1]),container=document.createElement(ordered?'ol':'ul')
      let item=list
      for(;;){
        const node=document.createElement('li');inline(node,item[2]);container.append(node)
        const next=/^\s*([-*+] |\d+\. )(.*)$/.exec(lines[index]??'')
        if(!next||/^\d/.test(next[1])!==ordered)break
        item=next;index++
      }
      target.append(container);continue
    }
    const paragraph=document.createElement('p'),body=[line]
    while(index<lines.length&&lines[index].trim()&&!/^(?:#{1,4}\s|```|\s*(?:[-*+] |\d+\. ))/.test(lines[index]))body.push(lines[index++])
    inline(paragraph,body.join('\n'));target.append(paragraph)
  }
}
