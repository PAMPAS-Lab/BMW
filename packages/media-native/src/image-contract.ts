import {finiteNumber,mediaRecord} from './media-contract.js'
export const DECODE_BUDGET=Object.freeze({imageBytes:32*1024*1024,sourcePixels:16_777_216,imagePixels:33_554_432,assetBytes:256*1024*1024})
export interface ImageInspection {kind:'image';contentType:'image/png'|'image/jpeg'|'image/webp';width:number;height:number;pixels:number;bytes:number;canDecode:true}
export function assertImageInspection(raw:unknown):ImageInspection {
  const value=mediaRecord(raw)
  if(value.kind!=='image'||!['image/png','image/jpeg','image/webp'].includes(String(value.contentType))||value.canDecode!==true)throw new TypeError('Invalid image inspection.')
  const width=finiteNumber(value.width,'image width',1,DECODE_BUDGET.sourcePixels,true),height=finiteNumber(value.height,'image height',1,DECODE_BUDGET.sourcePixels,true)
  finiteNumber(value.bytes,'image bytes',1,DECODE_BUDGET.imageBytes,true)
  if(width*height>DECODE_BUDGET.sourcePixels||value.pixels!==width*height)throw new TypeError('Image exceeds pixel limit or reports invalid dimensions.')
  return value as unknown as ImageInspection
}
/** Admit raster dimensions BEFORE a browser decoder allocates its full image. */
export function imageHeader(data:Uint8Array):Omit<ImageInspection,'kind'|'canDecode'> {
  finiteNumber(data.byteLength,'image bytes',1,DECODE_BUDGET.imageBytes,true)
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength),ascii=(at:number,n:number)=>String.fromCharCode(...data.subarray(at,at+n))
  let width=0,height=0,contentType:ImageInspection['contentType']
  if(data.length>=33&&[137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b)){
    contentType='image/png'
    if(view.getUint32(8)!==13||ascii(12,4)!=='IHDR')throw new Error('Invalid PNG header.')
    width=view.getUint32(16);height=view.getUint32(20)
    let end=false
    for(let at=8;at+12<=data.length;){const length=view.getUint32(at),type=ascii(at+4,4);if(at+length+12>data.length)throw new Error('Truncated PNG.')
      if(type==='acTL')throw new Error('Animated images require video conversion.')
      if(type==='IEND'){end=true;break}at+=length+12
    }
    if(!end)throw new Error('Missing PNG end.')
  }else if(data.length>=4&&data[0]===255&&data[1]===216){
    contentType='image/jpeg'
    for(let at=2;at+3<data.length;){
      if(data[at++]!==255)throw new Error('Invalid JPEG marker.')
      while(data[at]===255)at++
      const marker=data[at++];if(marker===0xda||marker===0xd9)break
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue
      if(at+2>data.length)throw new Error('Truncated JPEG.')
      const length=view.getUint16(at);if(length<2||at+length>data.length)throw new Error('Truncated JPEG segment.')
      if([0xc0,0xc1,0xc2].includes(marker)){if(width||length<8)throw new Error('Invalid JPEG dimensions.');height=view.getUint16(at+3);width=view.getUint16(at+5)}
      at+=length
    }
  }else if(data.length>=20&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
    contentType='image/webp';if(view.getUint32(4,true)+8!==data.length)throw new Error('Invalid WebP size.')
    let declaredWidth=0,declaredHeight=0
    for(let at=12;at+8<=data.length;){const type=ascii(at,4),length=view.getUint32(at+4,true),body=at+8;if(body+length>data.length)throw new Error('Truncated WebP.')
      if(type==='ANIM'||type==='ANMF')throw new Error('Animated images require video conversion.')
      if(type==='VP8X'){if(length<10||(data[body]&2))throw new Error('Invalid/animated WebP.');declaredWidth=1+data[body+4]+(data[body+5]<<8)+(data[body+6]<<16);declaredHeight=1+data[body+7]+(data[body+8]<<8)+(data[body+9]<<16)}
      if(type==='VP8 '){if(width||length<10||data[body+3]!==0x9d||data[body+4]!==1||data[body+5]!==0x2a)throw new Error('Invalid WebP frame.');width=view.getUint16(body+6,true)&0x3fff;height=view.getUint16(body+8,true)&0x3fff}
      if(type==='VP8L'){if(width||length<5||data[body]!==0x2f)throw new Error('Invalid lossless WebP.');const bits=view.getUint32(body+1,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1}
      at=body+length+(length%2)
    }
    if(declaredWidth&&(declaredWidth!==width||declaredHeight!==height))throw new Error('WebP dimensions disagree.')
  }else throw new Error('Only static PNG, JPEG and WebP images are supported.')
  assertImageInspection({kind:'image',contentType,width,height,pixels:width*height,bytes:data.length,canDecode:true})
  return {contentType,width,height,pixels:width*height,bytes:data.length}
}
export class ImageDecodeBudget {
  private pixels=0
  reserve(pixels:number):void{finiteNumber(pixels,'decoded pixels',1,DECODE_BUDGET.sourcePixels,true);if(this.pixels+pixels>DECODE_BUDGET.imagePixels)throw new Error('Decoded images exceed the shared 32 megapixel budget.');this.pixels+=pixels}
}
