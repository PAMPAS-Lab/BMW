import {assertArtifactId,finiteNumber,mediaRecord} from '../media-contract.js'
export interface VideoCoverOptions {title:string;subtitle:string;sourceArtifactId?:string;timestampSeconds:number;position:'top'|'bottom';fit:'contain'|'cover';background:string;textColor:string;accentColor:string}
export interface CoverRenderRequest {action:'video.cover';width:number;height:number;options:VideoCoverOptions;sourceKind?:'image'|'video'}
export interface CoverCommand {token:string;bytes:number;request:CoverRenderRequest}
export interface CoverBridge {
  onCommand(listener:(command:CoverCommand)=>void):void
  read(token:string,offset:number,length:number):Promise<Uint8Array>
  write(token:string,position:number,data:Uint8Array):Promise<void>
  reply(raw:unknown):void
}
export const coverOptionsSchema={type:'object',additionalProperties:false,properties:{title:{type:'string',maxLength:80},subtitle:{type:'string',maxLength:160},sourceArtifactId:{type:'string'},timestampSeconds:{type:'number',minimum:0,maximum:1800},position:{type:'string',enum:['top','bottom']},fit:{type:'string',enum:['contain','cover']},background:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},textColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},accentColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}}
export function assertCoverOptions(raw:unknown):VideoCoverOptions {
  const value=mediaRecord(raw)
  if(Object.keys(value).some(key=>!Object.keys(coverOptionsSchema.properties).includes(key)))throw new TypeError('Unsupported video cover property.')
  const text=(name:'title'|'subtitle',maximum:number)=>{const v=value[name]??'';if(typeof v!=='string'||v.length>maximum||/[\u0000-\u001f]/.test(v))throw new TypeError('Invalid cover '+name);return v}
  const color=(name:'background'|'textColor'|'accentColor',fallback:string)=>{const v=value[name]??fallback;if(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v))throw new TypeError('Cover colors require opaque #RRGGBB.');return v}
  const position=value.position??'bottom',fit=value.fit??'contain'
  if(position!=='top'&&position!=='bottom'||fit!=='contain'&&fit!=='cover')throw new TypeError('Invalid cover layout.')
  return {title:text('title',80),subtitle:text('subtitle',160),...(value.sourceArtifactId===undefined?{}:{sourceArtifactId:assertArtifactId(value.sourceArtifactId)}),timestampSeconds:finiteNumber(value.timestampSeconds??0,'cover timestamp',0,1800),position,fit,background:color('background','#101827'),textColor:color('textColor','#ffffff'),accentColor:color('accentColor','#67d5a0')}
}
export function assertCoverRenderRequest(raw:unknown):CoverRenderRequest {
  const value=mediaRecord(raw)
  if(value.action!=='video.cover'||Object.keys(value).some(key=>!['action','width','height','options','sourceKind'].includes(key)))throw new TypeError('Invalid native cover request.')
  const width=finiteNumber(value.width,'cover width',320,1920,true),height=finiteNumber(value.height,'cover height',180,1920,true),options=assertCoverOptions(value.options)
  if(options.sourceArtifactId){if(value.sourceKind!=='image'&&value.sourceKind!=='video')throw new TypeError('Cover needs a verified image/video source kind.')}
  else if(value.sourceKind!==undefined||options.timestampSeconds!==0)throw new TypeError('A frame timestamp requires a video source.')
  if(value.sourceKind==='image'&&options.timestampSeconds!==0)throw new TypeError('Static cover images cannot have a frame timestamp.')
  if(!options.sourceArtifactId&&!options.title.trim()&&!options.subtitle.trim())throw new TypeError('Choose a cover image or enter a title.')
  return {action:'video.cover',width,height,options,...(options.sourceArtifactId?{sourceKind:value.sourceKind as 'image'|'video'}:{})}
}
export function assertCoverReceipt(raw:unknown,width:number,height:number):{artifactId:string;width:number;height:number} {
  const value=mediaRecord(raw);assertArtifactId(value.artifactId)
  if(value.type!=='screenshot'||value.contentType!=='image/png'||value.width!==width||value.height!==height)throw new TypeError('Invalid native cover PNG receipt.')
  return {artifactId:String(value.artifactId),width,height}
}
