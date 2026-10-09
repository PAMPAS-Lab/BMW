import {referenceRecordsSchema} from './studio-reference-contract.js'
import {studioReviewItemsSchema} from './studio-review.js'
import {studioSpeechOriginSchema} from './studio-speech-origin.js'
import {visualLayersSchema,audioLayersSchema} from '../../media-native/src/composition-layers.js'
import {sourceCandidateSchema,sourceCaptionBindingSchema} from './studio-source-speech-contract.js'
import {sourceCitationSchema} from '@bmw-agent/media-native/sources'
import {focusIntervalsSchema} from '../../media-native/src/focus-contract.js'
import {studioSpeechCandidateSchema,studioSpeechAnchorsSchema,studioSpeechLinksSchema} from './studio-speech-contract.js'
import {coverOptionsSchema} from '../../media-native/src/media/processing.cover-contract.js'
import {visualSegmentsSchema} from '../../media-native/src/visual-segments.js'
import {narrationOptionsSchema} from '../../media-native/src/narration-contract.js'
import {videoOptionProperties} from '../../media-native/src/video-options.js'
import {sourceAudioProperties} from '../../media-native/src/composition-contract.js'
import {narrationTimingSchema} from '../../media-native/src/composition-contract.js'
const string={type:'string'},number={type:'number'},id={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}
export const studioDraftSchema={type:'object',additionalProperties:false,required:['version','id','revision','title','width','height','fps','music','scenes','updatedAt','exports'],properties:{
  referenceRecords:referenceRecordsSchema,reviewItems:studioReviewItemsSchema,layers:visualLayersSchema,audioTracks:audioLayersSchema,cardLayout:videoOptionProperties.cardLayout,narrationPacing:videoOptionProperties.narrationPacing,tts:videoOptionProperties.tts,style:videoOptionProperties.style,watermark:videoOptionProperties.watermark,templateName:{type:'string',maxLength:40},version:{type:'integer',const:1},id,ownerSessionId:id,revision:{type:'integer',minimum:1},title:{type:'string',maxLength:80},width:{type:'integer'},height:{type:'integer'},fps:{type:'integer'},music:{type:'boolean'},updatedAt:string,
  cover:coverOptionsSchema,coverExports:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['artifactId','width','height','revision','createdAt','options'],properties:{artifactId:string,width:{type:'integer'},height:{type:'integer'},revision:{type:'integer'},createdAt:string,options:coverOptionsSchema,actualTimestampSeconds:number}}},
  exports:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['artifactId','revision','createdAt','durationSeconds'],properties:{artifactId:string,verificationArtifactId:string,fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},revision:{type:'integer'},createdAt:string,durationSeconds:number}}},
  preparation:{type:'object',additionalProperties:false,required:['notes','outline','artifactIds'],properties:{sourceIds:{type:'array',maxItems:200,uniqueItems:true,items:id},notes:{type:'string',maxLength:20000},outline:{type:'string',maxLength:10000},artifactIds:{type:'array',maxItems:1000,uniqueItems:true,items:string}}},
  scenes:{type:'array',minItems:0,maxItems:24,items:{type:'object',additionalProperties:false,required:['id','title','durationSeconds','narration','visualBrief','sources','endPolicy'],properties:{
    speechPlaybackOrigin:studioSpeechOriginSchema,sourceSpeech:sourceCandidateSchema,sourceCaptionBinding:sourceCaptionBindingSchema,speechLinks:studioSpeechLinksSchema,speechCandidate:studioSpeechCandidateSchema,speechAnchors:studioSpeechAnchorsSchema,speechCaptions:{type:'boolean'},citations:{type:'array',maxItems:12,items:sourceCitationSchema},id,title:{type:'string',maxLength:44},label:string,narration:{type:'string',maxLength:1000},visualBrief:{type:'string',maxLength:2000},sources:{type:'array',maxItems:12,items:{type:'string',maxLength:2048}},endPolicy:{type:'string',enum:['require-footage','hold']},durationSeconds:{type:'number',minimum:1,maximum:60},
    layers:visualLayersSchema,audioTracks:audioLayersSchema,focusIntervals:focusIntervalsSchema,visualSegments:visualSegmentsSchema,...sourceAudioProperties,videoArtifactId:string,imageArtifactId:string,audioArtifactId:string,audioText:string,audioGeneration:{oneOf:[{type:'object',additionalProperties:false,required:['kind'],properties:{kind:{const:'imported'},autoTiming:{readOnly:true,...narrationTimingSchema}}},{type:'object',additionalProperties:false,required:['kind','options'],properties:{kind:{enum:['tts','legacy']},options:narrationOptionsSchema,autoTiming:{readOnly:true,...narrationTimingSchema}}}]},audioDurationSeconds:number,sourceDurationSeconds:number,sourceStartSeconds:number,zoom:number,playbackRate:{type:'number',minimum:.25,maximum:2},voiceVolume:{type:'number',minimum:0,maximum:2},layout:{type:'string',enum:['presentation','fullscreen']},bullets:{type:'array',maxItems:3,items:string},
    crop:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:number,y:number,width:number,height:number}},
    captions:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds','text'],properties:{startSeconds:number,endSeconds:number,text:{type:'string',maxLength:200},translationText:{type:'string',maxLength:200},translationOrigin:{enum:['user-edited','agent-edited']}}}}
  }}}
}}
