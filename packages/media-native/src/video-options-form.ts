import { assertVideoOptions, videoDimensions, DEFAULT_VIDEO_OPTIONS } from './video-options.js'
import type { VideoOptions } from './video-options.js'
/** Shared native form, inheriting the BMW surface's typography and theme. */
export class VideoOptionsForm {
  private initialLayout?:VideoOptions['cardLayout']
  private initialPacing?:VideoOptions['narrationPacing']
  constructor(private root:HTMLElement,private prefix:string,changed?:()=>void){
    root.innerHTML=`<div class="video-options-grid">
      <label>画面比例<select id="${prefix}-ratio"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option><option value="4:3">4:3 横屏</option><option value="3:4">3:4 竖屏</option></select></label>
      <label>分辨率<select id="${prefix}-resolution"><option value="720p">720p · 短边 720</option><option value="1080p">1080p · 短边 1080</option><option value="custom">自定义尺寸</option></select></label>
      <label class="video-options-custom">宽度<input id="${prefix}-width" type="number" min="320" max="1920" step="2"></label><label class="video-options-custom">高度<input id="${prefix}-height" type="number" min="180" max="1920" step="2"></label>
      <label>画面风格<select id="${prefix}-style"><option value="bmw-dark">BMW 深色</option><option value="clean-light">简洁浅色</option><option value="minimal">极简</option></select></label>
      <label>全片布局<select id="${prefix}-card-layout"><option value="standard">标准</option><option value="news">资讯 · 固定标题与字幕区</option></select></label>
      <label>旁白节奏<select id="${prefix}-narration-pacing"><option value="standard">标准 · 前后各半秒</option><option value="compact">紧凑 · 前后各两帧</option></select></label>
      <p class="video-options-note video-options-wide">资讯布局支持横屏、竖屏，使用全片标题和顶部品牌；紧凑节奏用于之后新生成或新导入的完整旁白，保留已有剪切与字幕。</p>
      <label>帧率<input id="${prefix}-fps" type="number" min="12" max="30" step="1"></label>
      <label>旁白音色<select id="${prefix}-tts-voice"><option value="zh-CN-YunxiNeural">Edge 男声 · 云希</option><option value="zh-CN-XiaoxiaoNeural">Edge 女声 · 晓晓</option><option value="local-zh-en">本地 Matcha · 中英</option></select></label>
      <label>旁白语速（%）<input id="${prefix}-tts-rate" type="number" min="-20" max="30" step="1"></label>
      <p class="video-options-note video-options-wide">Edge 在线配音默认开启，会将旁白文本发送到微软服务；可在 Media → Video narration 关闭。本地配音不联网。修改配音参数后需重新制作旁白。</p>
      <label class="video-options-check"><input id="${prefix}-music" type="checkbox">背景音乐</label>
      <label class="video-options-check"><input id="${prefix}-watermark-enabled" type="checkbox">文字水印</label>
      <label class="video-options-wide">水印文字<input id="${prefix}-watermark-text" maxlength="60" placeholder="品牌或署名"></label>
      <label>水印位置<select id="${prefix}-watermark-position"><option value="bottom-left">左下</option><option value="bottom-right">右下</option><option value="top-left">左上</option><option value="top-right">右上</option></select></label>
      <label>水印大小<input id="${prefix}-watermark-size" type="number" min="10" max="32" step="1"></label>
      <label class="video-options-wide">水印不透明度<input id="${prefix}-watermark-opacity" type="range" min="0.1" max="1" step="0.05"></label>
    </div><p id="${prefix}-dimensions" class="video-options-note"></p>`
    root.addEventListener('change',()=>{this.dimensions();changed?.()})
    this.fill(structuredClone(DEFAULT_VIDEO_OPTIONS))
  }
  private control<T extends HTMLInputElement|HTMLSelectElement>(key:string):T{return this.root.querySelector('#'+this.prefix+'-'+key) as T}
  fill(value:VideoOptions):void {
    this.initialLayout=value.cardLayout;this.initialPacing=value.narrationPacing
    for(const [key,text] of [['card-layout',value.cardLayout??'standard'],['narration-pacing',value.narrationPacing??'standard'],['ratio',value.aspectRatio],['resolution',value.resolution],['style',value.style],['fps',value.fps],['tts-voice',value.tts.voice],['tts-rate',value.tts.ratePercent],['width',value.width??videoDimensions(value).width],['height',value.height??videoDimensions(value).height],['watermark-text',value.watermark.text],['watermark-position',value.watermark.position],['watermark-size',value.watermark.size],['watermark-opacity',value.watermark.opacity]] as const)this.control(key).value=String(text)
    this.control<HTMLInputElement>('music').checked=value.music;this.control<HTMLInputElement>('watermark-enabled').checked=value.watermark.enabled;this.dimensions()
  }
  read():VideoOptions{return assertVideoOptions({...((this.initialLayout!==undefined||this.control('card-layout').value!=='standard')?{cardLayout:this.control('card-layout').value}:{}),...((this.initialPacing!==undefined||this.control('narration-pacing').value!=='standard')?{narrationPacing:this.control('narration-pacing').value}:{}),aspectRatio:this.control('ratio').value,resolution:this.control('resolution').value,...(this.control('resolution').value==='custom'?{width:Number(this.control('width').value),height:Number(this.control('height').value)}:{}),style:this.control('style').value,fps:Number(this.control('fps').value),music:this.control<HTMLInputElement>('music').checked,tts:{provider:this.control('tts-voice').value==='local-zh-en'?'local-matcha':'edge-readaloud',voice:this.control('tts-voice').value,ratePercent:Number(this.control('tts-rate').value)},watermark:{enabled:this.control<HTMLInputElement>('watermark-enabled').checked,text:this.control('watermark-text').value,position:this.control('watermark-position').value,opacity:Number(this.control('watermark-opacity').value),size:Number(this.control('watermark-size').value)}})}
  private dimensions():void {
    this.control<HTMLSelectElement>('watermark-position').disabled=this.control('card-layout').value==='news'
    this.root.querySelectorAll<HTMLElement>('.video-options-custom').forEach(node=>{node.hidden=this.control('resolution').value!=='custom'})
    const node=this.root.querySelector('#'+this.prefix+'-dimensions')!
    try{const size=videoDimensions(this.read());node.textContent=`${size.width} × ${size.height} · MP4 / H.264 + AAC`}catch(error){node.textContent=error instanceof Error?error.message:String(error)}
  }
}
