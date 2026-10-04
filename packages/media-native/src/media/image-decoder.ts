import {ImageDecodeBudget,imageHeader} from '../image-contract.js'
import type {ImageInspection} from '../image-contract.js'
/** Shared inspector/preview/export decoder with admission before allocation. */
export async function decodeProjectImage(data:Uint8Array,budget:ImageDecodeBudget):Promise<{image:HTMLCanvasElement;info:ImageInspection}> {
  const header=imageHeader(data);budget.reserve(header.pixels)
  const bitmap=await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>],{type:header.contentType}))
  try{
    if(!((bitmap.width===header.width&&bitmap.height===header.height)||(bitmap.width===header.height&&bitmap.height===header.width)))throw new Error('Decoded image dimensions disagree with its header.')
    const image=document.createElement('canvas');image.width=bitmap.width;image.height=bitmap.height
    const context=image.getContext('2d');if(!context)throw new Error('Image canvas is unavailable.')
    context.drawImage(bitmap,0,0)
    return {image,info:{kind:'image',...header,width:bitmap.width,height:bitmap.height,canDecode:true}}
  }finally{bitmap.close()}
}
