export interface SourceAudioChunk {sampleRate:number;numberOfChannels:number;length:number;getChannelData(channel:number):Float32Array}
/** Place only the selected source interval; footage speed retimes its original sound. */
export function mixSourceAudioChunk(target:Float32Array[],chunk:SourceAudioChunk,timestamp:number,sceneStart:number,sceneDuration:number,sourceStart:number,rate:number,gain:number,gainAt?:(localSeconds:number)=>number):void{
  const from=Math.max(0,(timestamp-sourceStart)/rate),to=Math.min(sceneDuration,(timestamp+chunk.length/chunk.sampleRate-sourceStart)/rate)
  if(to<=from||gain===0)return
  const begin=Math.max(0,Math.ceil((sceneStart+from)*48000)),end=Math.min(target[0].length,Math.ceil((sceneStart+to)*48000))
  for(let channel=0;channel<target.length;channel++){
    const source=chunk.getChannelData(Math.min(channel,chunk.numberOfChannels-1))
    for(let index=begin;index<end;index++){
      const position=((index/48000-sceneStart)*rate+sourceStart-timestamp)*chunk.sampleRate,left=Math.floor(position)
      if(left<0||left>=source.length)continue
      const fraction=position-left;target[channel][index]+=(source[left]*(1-fraction)+source[Math.min(left+1,source.length-1)]*fraction)*gain*(gainAt?.(index/48000-sceneStart)??1)
    }
  }
}
