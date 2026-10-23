/** Page evidence, never a claim about an author's upload or a model assertion. */
export interface VideoIdentity {version:1;platform:'page'|'youtube'|'x'|'weibo';targetId:string;resourceId:string}
export interface VideoResource {url:string;role:'video'|'audio'|'muxed'|'hls'|'sabr';durationSeconds:number|null;bitrate:number;audioGroup:string;defaultAudio:boolean}
export interface VideoTarget {identity:VideoIdentity;playerUrl:string;videoIndex:number;durationSeconds:number|null;resources:VideoResource[]}
export interface VideoTargetScope {selector?:string;index?:number;excludeSelectors?:string[]}
export interface PageVideoTargets {pageUrl:string;platform:VideoIdentity['platform'];targets:VideoTarget[];blocked:string|null}

export const YOUTUBE_SABR_REQUEST_BYTES=256*1024
export function youtubeSabrUrl(value:string):URL {
 const url=new URL(value)
 if(value.length>8192||url.protocol!=='https:'||!url.hostname.endsWith('.googlevideo.com')||url.port||url.username||url.password||url.pathname!=='/videoplayback'||!url.searchParams.get('id'))throw new Error('YOUTUBE_SABR_URL: Expected the current Googlevideo HTTPS streaming endpoint.')
 return url
}

export function assertVideoIdentity(raw:unknown):VideoIdentity{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid video identity.')
 const v=raw as Record<string,unknown>
 if(Object.keys(v).some(k=>!['version','platform','targetId','resourceId'].includes(k))||v.version!==1||!['page','youtube','x','weibo'].includes(String(v.platform)))throw new TypeError('Invalid video identity.')
 for(const key of ['targetId','resourceId'])if(typeof v[key]!=='string'||!v[key].length||v[key].length>4096||v[key].includes('\0'))throw new TypeError('Invalid video identity '+key)
 return {version:1,platform:v.platform as VideoIdentity['platform'],targetId:v.targetId as string,resourceId:v.resourceId as string}
}
export function sameVideoIdentity(a:VideoIdentity,b:VideoIdentity):boolean{return a.version===b.version&&a.platform===b.platform&&a.targetId===b.targetId&&a.resourceId===b.resourceId}
export function assertPageVideoTargets(raw:unknown):PageVideoTargets{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid video target snapshot.')
 const r=raw as Record<string,unknown>,url=(raw:unknown,blob=false)=>{if(typeof raw!=='string'||raw.length>8192)throw new TypeError('Invalid target URL.');const u=new URL(raw);if(u.username||u.password||!(blob?['http:','https:','blob:']:['http:','https:']).includes(u.protocol))throw new TypeError('Invalid target URL.');return u.href},seconds=(v:unknown)=>{if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>86400)throw new TypeError('Invalid target duration.');return v}
 if(Object.keys(r).some(k=>!['pageUrl','platform','targets','blocked'].includes(k))||!['page','youtube','x','weibo'].includes(String(r.platform))||r.blocked!==null&&(typeof r.blocked!=='string'||r.blocked.length>1000)||!Array.isArray(r.targets)||r.targets.length>64||JSON.stringify(raw).length>256*1024)throw new TypeError('Invalid video target snapshot budget.')
 const targets=r.targets.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid player witness.');const t=raw as Record<string,unknown>,identity=assertVideoIdentity(t.identity)
  if(Object.keys(t).some(k=>!['identity','playerUrl','videoIndex','durationSeconds','resources'].includes(k))||identity.platform!==r.platform||!Number.isSafeInteger(t.videoIndex)||Number(t.videoIndex)<-1||Number(t.videoIndex)>10000||!Array.isArray(t.resources)||t.resources.length>160)throw new TypeError('Invalid player witness.')
  const resources=t.resources.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid resource witness.');const f=raw as Record<string,unknown>;if(Object.keys(f).some(k=>!['url','role','durationSeconds','bitrate','audioGroup','defaultAudio'].includes(k))||!['video','audio','muxed','hls','sabr'].includes(String(f.role))||typeof f.bitrate!=='number'||!Number.isFinite(f.bitrate)||f.bitrate<0||typeof f.audioGroup!=='string'||f.audioGroup.length>100||typeof f.defaultAudio!=='boolean')throw new TypeError('Invalid resource witness.');const address=url(f.url);if(identity.platform==='youtube'&&!(new URL(address).protocol==='https:'&&new URL(address).hostname.endsWith('.googlevideo.com'))||f.role==='sabr'&&(identity.platform!=='youtube'||new URL(address).pathname!=='/videoplayback'))throw new TypeError('Foreign YouTube delivery resource.');return {url:address,role:f.role as VideoResource['role'],durationSeconds:seconds(f.durationSeconds),bitrate:f.bitrate,audioGroup:f.audioGroup,defaultAudio:f.defaultAudio}})
  return {identity,playerUrl:t.playerUrl===''?'':url(t.playerUrl,true),videoIndex:Number(t.videoIndex),durationSeconds:seconds(t.durationSeconds),resources}
 })
 const page=new URL(String(r.pageUrl));page.hash=''
 if(page.username||page.password||!['http:','https:','file:'].includes(page.protocol))throw new TypeError('Invalid target page.')
 const host=page.hostname.replace(/^www\./,''),platform:VideoIdentity['platform']=['youtube.com','m.youtube.com','youtu.be'].includes(host)?'youtube':['x.com','twitter.com','mobile.twitter.com'].includes(host)?'x':['weibo.com','m.weibo.cn','video.weibo.com'].includes(host)?'weibo':'page'
 const expected=platform==='youtube'?(page.searchParams.get('v')??/^\/(?:shorts|embed|live)\/([^/]+)/.exec(page.pathname)?.[1]??(host==='youtu.be'?page.pathname.slice(1):'')):platform==='x'?/^\/[^/]+\/status\/(\d+)/.exec(page.pathname)?.[1]??'':page.href
 if(platform!==r.platform||targets.some(t=>t.identity.targetId!==expected||platform==='youtube'&&t.identity.resourceId!==expected))throw new TypeError('Video identity does not match its page target.')
 return {pageUrl:page.href,platform,blocked:r.blocked as string|null,targets}
}
export function twitterMediaId(value:string):string|null{
 try{const u=new URL(value);if(!['video.twimg.com','pbs.twimg.com'].includes(u.hostname))return null;return /^\/(?:amplify_video(?:_thumb)?|ext_tw_video(?:_thumb)?|tweet_video(?:_thumb)?)\/([a-zA-Z0-9_-]+)(?:\/|\.)/.exec(u.pathname)?.[1]??null}catch{return null}
}
export function resourceBelongsToTarget(target:VideoTarget,url:string):boolean{
 return target.playerUrl===url||target.resources.some(r=>r.url===url)||(target.identity.platform==='x'&&twitterMediaId(url)===target.identity.resourceId)
}
export function selectVideoResource(state:PageVideoTargets,url:string,expected?:VideoIdentity):VideoTarget{
 if(state.blocked)throw new Error('VIDEO_IDENTITY_UNAVAILABLE: '+state.blocked)
 if(/^https?:/.test(url)&&state.platform==='youtube'&&state.targets.length&&state.targets.every(t=>!t.resources.length))throw new Error('YOUTUBE_DIRECT_DELIVERY_UNAVAILABLE: The current target has no complete HTTP/HLS delivery URLs. SABR/UMP and signature-only streams require a separate native acquisition path; no recording or unrelated media was substituted.')
 const targets=state.targets.filter(t=>resourceBelongsToTarget(t,url)&&(!expected||sameVideoIdentity(expected,t.identity)))
 if(targets.length!==1)throw new Error('VIDEO_IDENTITY_UNBOUND: Resource is not uniquely bound to the requested video. Observe the target player and collect again.')
 return targets[0]!
}
export function youtubeAudioFor(target:VideoTarget,url:string):VideoResource|undefined{
 if(target.identity.platform!=='youtube')return
 const selected=target.resources.find(r=>r.url===url)
 if(!selected)throw new Error('YOUTUBE_RESOURCE_CHANGED: Observe the current player again.')
 if(selected.role==='audio')throw new Error('Choose a video resource, not an isolated audio track.')
 if(selected.role!=='video')return
 const audios=target.resources.filter(r=>r.role==='audio'),defaults=audios.filter(r=>r.defaultAudio),eligible=defaults.length?defaults:audios
 const groups=new Set(eligible.map(a=>a.audioGroup))
 if(!eligible.length||groups.size!==1)throw new Error('YOUTUBE_AUDIO_UNAVAILABLE: A unique default audio language is required; no audio track was discarded.')
 return [...eligible].sort((a,b)=>b.bitrate-a.bitrate||a.url.localeCompare(b.url))[0]
}

/** Fixed, read-only renderer program. No cookies, headers, storage or arbitrary script execution.
 * Kept self-contained because the host serializes it into sandboxed page renderers. */
export function inspectPageVideoTargets(scope:VideoTargetScope={}):PageVideoTargets{
 const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
 const address=(value:unknown):string=>{try{if(typeof value!=='string'||value.length>8192)return '';const u=new URL(value,location.href);if(u.username||u.password||!['http:','https:','blob:'].includes(u.protocol))return '';u.hash='';return u.href}catch{return ''}}
 const visible=(el:Element):boolean=>{if(!el.getClientRects().length)return false;let n=0;for(let e:Element|null=el;e;e=e.parentElement){if(++n>100)return false;const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false}return true}
 const page=new URL(location.href);page.hash='';const pageUrl=page.href,host=page.hostname.replace(/^www\./,''),platform:VideoIdentity['platform']=host==='youtube.com'||host==='m.youtube.com'||host==='youtu.be'?'youtube':host==='x.com'||host==='twitter.com'||host==='mobile.twitter.com'?'x':host==='weibo.com'||host==='m.weibo.cn'||host==='video.weibo.com'?'weibo':'page'
 const result:PageVideoTargets={pageUrl,platform,targets:[],blocked:null},root=scope.selector?document.querySelectorAll(scope.selector)[scope.index??0]:document
 if(!root){result.blocked='The selected media range is missing.';return result}
 const excluded=['[hidden]','[aria-hidden="true"]','[contenteditable]:not([contenteditable="false"])',...(scope.excludeSelectors??[])]
 const badRoot=document.querySelector('[data-bmw-video-error],.ytp-error-content-wrap,.error-page,[data-testid="error-detail"]')
 if(badRoot&&visible(badRoot)&&(badRoot.textContent??'').trim()){result.blocked='The page displays a playback/access error.';return result}
 const videos=[...(root instanceof HTMLVideoElement?[root]:root.querySelectorAll('video'))]
 if(videos.length>64){result.blocked='Too many players; select a narrower target range.';return result}
 const duration=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0&&n<=86400?n:null}
 const allVideos=[...document.querySelectorAll('video')]
 let expected=platform==='youtube'?(page.searchParams.get('v')??/^\/(?:shorts|embed|live)\/([^/]+)/.exec(page.pathname)?.[1]??(host==='youtu.be'?page.pathname.slice(1):'')):platform==='x'?/^\/[^/]+\/status\/(\d+)/.exec(page.pathname)?.[1]??'':pageUrl
 if(!expected||expected.length>4096){result.blocked='Open an original video/post URL before acquiring video.';return result}
 for(const video of videos){
  if(!visible(video)||excluded.some(s=>video.closest(s))||video.closest('[data-bmw-ad],.ad-showing,[data-testid="placementTracking"],[data-testid="promotedIndicator"]'))continue
  const playerUrl=address(video.currentSrc||video.src)
  // These are site UI animations, never a user's video, regardless of MIME or duration.
  if(/\/(?:playback[0-9]+|error-animation|loading-animation)\.mp4(?:\?|$)/i.test(playerUrl))continue
  let resourceId=playerUrl,resources:VideoResource[]=[],seconds=duration(video.duration)
  const add=(url:unknown,role:VideoResource['role'],extra:Partial<VideoResource>={})=>{const u=address(url);if(u&&!u.startsWith('blob:')&&!resources.some(r=>r.url===u))resources.push({url:u,role,durationSeconds:seconds,bitrate:0,audioGroup:'',defaultAudio:false,...extra})}
  if(platform==='youtube'){
   const player=video.closest('#movie_player') as HTMLElement&{getVideoData?:()=>unknown;getPlayerResponse?:()=>unknown}
   if(!player||player.classList.contains('ad-showing'))continue
   const data=record(player.getVideoData?.()),response=record(player.getPlayerResponse?.()),details=record(response.videoDetails),status=record(response.playabilityStatus)
   if(data.video_id!==expected||details.videoId!==expected||status.status&&status.status!=='OK')continue
   const declared=duration(details.lengthSeconds)
   if(!declared||seconds!==null&&Math.abs(seconds-declared)>Math.max(.5,declared*.01))continue
   seconds=declared;resourceId=expected
   const streaming=record(response.streamingData)
   const formats=[...(Array.isArray(streaming.formats)?streaming.formats:[]),...(Array.isArray(streaming.adaptiveFormats)?streaming.adaptiveFormats:[])]
   if(formats.length>160)continue
   for(const raw of formats){const f=record(raw),url=address(f.url);if(!url)continue;const u=new URL(url)
    if(u.protocol!=='https:'||!u.hostname.endsWith('.googlevideo.com')||u.pathname!=='/videoplayback'||u.searchParams.has('range')||!u.searchParams.get('itag')||u.searchParams.get('source')&&u.searchParams.get('source')!=='youtube')continue
    if(f.itag!==undefined&&String(f.itag)!==u.searchParams.get('itag'))continue
    const urlDuration=duration(u.searchParams.get('dur'))
    if(u.searchParams.has('dur')&&(urlDuration===null||Math.abs(urlDuration-declared)>Math.max(.5,declared*.01)))continue
    if(['clen','lmt'].some(key=>{const value=f[key==='clen'?'contentLength':'lastModified'];return value!==undefined&&u.searchParams.has(key)&&String(value)!==u.searchParams.get(key)}))continue
    const mime=typeof f.mimeType==='string'?f.mimeType:'',isVideo=mime.startsWith('video/'),isAudio=mime.startsWith('audio/'),d=duration(Number(f.approxDurationMs)/1000)??declared
    if(!isVideo&&!isAudio||Math.abs(d-declared)>Math.max(.5,declared*.01))continue
    const audio=record(f.audioTrack),audioGroup=typeof audio.id==='string'&&audio.id.length<=100?audio.id:'default'
    add(url,isAudio?'audio':f.audioQuality?'muxed':'video',{durationSeconds:d,bitrate:typeof f.bitrate==='number'&&Number.isFinite(f.bitrate)&&f.bitrate>=0?f.bitrate:0,audioGroup,defaultAudio:audio.audioIsDefault===true})
   }
   const hls=address(streaming.hlsManifestUrl)
   if(hls){const u=new URL(hls);if(u.protocol==='https:'&&u.hostname.endsWith('.googlevideo.com'))add(hls,'hls')}
   const sabr=address(streaming.serverAbrStreamingUrl)
   if(sabr){const u=new URL(sabr);if(u.protocol==='https:'&&u.hostname.endsWith('.googlevideo.com')&&u.pathname==='/videoplayback')add(sabr,'sabr')}
  }else if(platform==='x'){
   const article=video.closest('article,[data-testid="tweet"],[role="article"]')
   if(!article||video.closest('[data-testid="quoteTweet"]')||article.querySelector('[data-testid="promotedIndicator"]'))continue
   const links=[...article.querySelectorAll('a[href]')].filter(a=>a.closest('article,[data-testid="tweet"],[role="article"]')===article&&(a.querySelector('time')||/\d{4}年\d{1,2}月\d{1,2}日|\b\d{1,2}:\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i.test((a.textContent??'').trim())))
   if(!links.some(a=>{try{return /^\/[^/]+\/status\/(\d+)/.exec(new URL((a as HTMLAnchorElement).href).pathname)?.[1]===expected}catch{return false}}))continue
   let media:RegExpExecArray|null=null
   try{const poster=new URL(video.poster);if(poster.hostname==='pbs.twimg.com')media=/^\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/([a-zA-Z0-9_-]+)(?:\/|\.)/.exec(poster.pathname)}catch{/* A missing media identity is unavailable, never guessed. */}
   if(!media)continue;resourceId=media[1]!
   if(playerUrl.startsWith('http')){const u=new URL(playerUrl),id=/^\/(?:amplify_video|ext_tw_video|tweet_video)\/([a-zA-Z0-9_-]+)(?:\/|\.)/.exec(u.pathname)?.[1];if(u.hostname!=='video.twimg.com'||id!==resourceId)continue;add(playerUrl,/\.m3u8(?:\?|$)/.test(playerUrl)?'hls':'muxed')}
  }else{
   // A dedicated Weibo video page binds its single player. Feed/reply pages
   // require an explicit range; a full-page first-player heuristic is refused.
   if(platform==='weibo'&&!scope.selector&&!/^\/(?:tv\/show|show)(?:\/|$)/.test(page.pathname))continue
   if(platform==='weibo'&&videos.filter(v=>visible(v)).length!==1)continue
   if(!playerUrl){
    if(platform==='page'&&video.srcObject instanceof MediaStream)resourceId='stream:'+video.srcObject.id
    // Inline media has no transferable URL. Capture pins its full source in
    // the renderer closure; only the selected element witness leaves the page.
    else if(platform==='page'&&(video.currentSrc||video.src).startsWith('data:video/'))resourceId='inline-player:'+allVideos.indexOf(video)
    else continue
   }
   add(playerUrl,/\.m3u8(?:\?|$)/.test(playerUrl)?'hls':'muxed')
   for(const s of video.querySelectorAll('source[src]'))add((s as HTMLSourceElement).src,/\.m3u8(?:\?|$)/.test((s as HTMLSourceElement).src)?'hls':'muxed')
  }
  if(!resourceId)continue
  result.targets.push({identity:{version:1,platform,targetId:expected,resourceId},playerUrl,videoIndex:allVideos.indexOf(video),durationSeconds:seconds,resources})
 }
 if(platform==='page')for(const source of [...(root instanceof HTMLSourceElement?[root]:root.querySelectorAll('source[src]'))].slice(0,64)){
  if(source.closest('video')||!source.parentElement||!visible(source.parentElement)||excluded.some(s=>source.closest(s)))continue
  const url=address(source.src);if(!url||url.startsWith('blob:'))continue
  result.targets.push({identity:{version:1,platform,targetId:pageUrl,resourceId:url},playerUrl:url,videoIndex:-1,durationSeconds:null,resources:[{url,role:/\.m3u8(?:\?|$)/.test(url)?'hls':'muxed',durationSeconds:null,bitrate:0,audioGroup:'',defaultAudio:false}]})
 }
 if(result.targets.length>64){result.targets=[];result.blocked='Too many resources; select a narrower range.'}
 if(platform!=='page'&&!result.targets.length)result.blocked='The original target player is unavailable, showing an ad, restricted, or differs from the page video identity.'
 return result
}
