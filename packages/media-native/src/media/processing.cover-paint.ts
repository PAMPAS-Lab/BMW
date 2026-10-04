import type {VideoCoverOptions} from './processing.cover-contract.js'
/** Bounded still-image layout. Cover artwork is independent of narration/captions. */
export function paintCover(canvas:HTMLCanvasElement,options:VideoCoverOptions,source?:HTMLCanvasElement|OffscreenCanvas):void {
  const x=canvas.getContext('2d');if(!x)throw new Error('Cover canvas is unavailable.')
  const w=canvas.width,h=canvas.height,pad=Math.max(14,w*.045),hasText=Boolean(options.title.trim()||options.subtitle.trim()),band=hasText?Math.round(h*.32):0,y=options.position==='top'?band:0,hero=h-band
  x.fillStyle=options.background;x.fillRect(0,0,w,h)
  if(source){
    const scale=options.fit==='cover'?Math.max(w/source.width,hero/source.height):Math.min(w/source.width,hero/source.height)
    x.save();x.beginPath();x.rect(0,y,w,hero);x.clip();x.drawImage(source,(w-source.width*scale)/2,y+(hero-source.height*scale)/2,source.width*scale,source.height*scale);x.restore()
  }else{
    x.save();x.globalAlpha=.16;x.fillStyle=options.accentColor;x.beginPath();x.arc(w*.8,y+hero*.3,Math.min(w,hero)*.4,0,Math.PI*2);x.fill();x.restore()
  }
  if(!hasText)return
  const top=options.position==='top'?0:hero,maxWidth=w-2*pad
  const wrap=(text:string,size:number,bold:boolean)=>{
    x.font=`${bold?'700':'400'} ${size}px sans-serif`;const lines:string[]=[];let line=''
    for(const char of text){if(line&&x.measureText(line+char).width>maxWidth){lines.push(line);line=''}line+=char}if(line)lines.push(line);return lines
  }
  let font=Math.max(16,Math.min(80,w*.085,h*.095)),sub=font*.5,title:string[]=[],subtitle:string[]=[]
  for(;;){title=wrap(options.title,font,true);subtitle=wrap(options.subtitle,sub,false)
    if(title.length<=4&&subtitle.length<=4&&title.length*font*1.2+subtitle.length*sub*1.35+(title.length&&subtitle.length?font*.22:0)<=band-pad*1.3)break
    if(font<=10)throw new Error('Cover text does not fit; shorten the title or subtitle.')
    font-=1;sub=Math.max(8,font*.5)
  }
  x.fillStyle=options.accentColor;x.fillRect(0,top,Math.max(4,w*.012),band)
  x.textBaseline='top';x.fillStyle=options.textColor
  let at=top+pad*.65;x.font=`700 ${font}px sans-serif`;for(const line of title){x.fillText(line,pad,at);at+=font*1.2}
  if(title.length&&subtitle.length)at+=font*.22
  x.font=`400 ${sub}px sans-serif`;for(const line of subtitle){x.fillText(line,pad,at);at+=sub*1.35}
}
