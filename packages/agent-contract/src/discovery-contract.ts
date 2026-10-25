export interface DiscoveryLead {url:string;summary:string;excerptTruncated:boolean;displayTime:string|null;publishedAt:string|null;pinned:boolean}
const text=(raw:unknown,name:string,max:number):string=>{if(typeof raw!=='string'||!raw.trim()||raw.length>max)throw new TypeError('Invalid discovery '+name);return raw}
const mediaRecord=(raw:unknown):Record<string,unknown>=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid discovery object');return raw as Record<string,unknown>}
const closed=(v:Record<string,unknown>,keys:readonly string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported discovery field')}
const array=(raw:unknown,max:number,_name:string):unknown[]=>{if(!Array.isArray(raw)||raw.length>max)throw new TypeError('Invalid discovery list');return raw}
const url=(raw:unknown)=>new URL(text(raw,'URL',200)).href
const date=(raw:unknown)=>{const v=text(raw,'date',40);if(!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw new TypeError('Invalid discovery date');return v}
export function assertDiscoveryLeads(raw:unknown,requested:string):DiscoveryLead[]{
 const target=new URL(requested),account=target.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
 const leads=array(raw,5,'discovery leads').map(raw=>{const v=mediaRecord(raw);closed(v,['url','summary','excerptTruncated','displayTime','publishedAt','pinned']);const address=url(v.url),post=new URL(address),parts=post.pathname.split('/').filter(Boolean)
  if(post.protocol!=='https:'||post.username||post.password||post.port||!['x.com','twitter.com'].includes(post.hostname)||post.search||post.hash||parts.length!==3||parts[0].toLowerCase()!==account||parts[1]!=='status'||!/^\d+$/.test(parts[2]))throw new TypeError('Discovery requires same-account canonical post links.')
  if(typeof v.excerptTruncated!=='boolean'||typeof v.pinned!=='boolean')throw new TypeError('Invalid discovery flags.')
  return {url:address,summary:text(v.summary,'post excerpt',360),excerptTruncated:v.excerptTruncated,displayTime:v.displayTime===null?null:text(v.displayTime,'display time',80),publishedAt:v.publishedAt===null?null:date(v.publishedAt),pinned:v.pinned}
 })
 if(new Set(leads.map(lead=>lead.url)).size!==leads.length)throw new TypeError('Duplicate discovery post.')
 return leads
}
