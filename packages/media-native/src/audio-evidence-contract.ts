import {finiteNumber,mediaRecord} from './media-contract.js'
export interface AudioEvidence {startSeconds:number;endSeconds:number;sampleRate:number;channels:number;frames:number;peak:number;rms:number;clippedSamples:number;missingFrames:number;windows:{startSeconds:number;endSeconds:number;rms:number;peak:number}[];listeningStatus:'not-performed';processing:'native-rate-and-channels; PCM16 quantization; no gain/resampling';timebase:'input-file-PTS'}
export function assertAudioEvidence(raw:unknown,start:number,end:number):AudioEvidence{
 const v=mediaRecord(raw),rate=finiteNumber(v.sampleRate,'audio sample rate',8000,96000,true),channels=finiteNumber(v.channels,'audio channels',1,8,true),frames=finiteNumber(v.frames,'audio sample frames',1,96000*10,true)
 if(v.startSeconds!==start||v.endSeconds!==end||Math.abs(frames/rate-(end-start))>1/rate||v.listeningStatus!=='not-performed'||v.processing!=='native-rate-and-channels; PCM16 quantization; no gain/resampling'||v.timebase!=='input-file-PTS'||!Array.isArray(v.windows)||!v.windows.length||v.windows.length>101)throw new Error('Invalid audio interval/listening evidence.')
 finiteNumber(v.peak,'audio peak',0,128);finiteNumber(v.rms,'audio RMS',0,128);finiteNumber(v.clippedSamples,'audio PCM clipping',0,frames*channels,true);finiteNumber(v.missingFrames,'audio missing frames',0,frames,true)
 let previous=start
 for(const raw of v.windows){const w=mediaRecord(raw);if(Math.abs(Number(w.startSeconds)-previous)>1/rate)throw new Error('Audio window timeline has a gap.');previous=finiteNumber(w.endSeconds,'audio window end',previous,end+1/rate);finiteNumber(w.rms,'window RMS',0,128);finiteNumber(w.peak,'window peak',0,128)}
 if(Math.abs(previous-end)>1/rate)throw new Error('Audio windows do not cover the requested interval.')
 return v as unknown as AudioEvidence
}
