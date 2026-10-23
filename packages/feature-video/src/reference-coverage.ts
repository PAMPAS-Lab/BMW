import type {StudioReferenceFrame} from './studio-reference-contract.js'
export interface SelectedReferenceInterval {sceneId:string;artifactId:string;visualIndex:number;startSeconds:number;endExclusive:number}
export interface ReferenceCoverageGap extends SelectedReferenceInterval {referenceId?:string;code:'reference-coverage';message:string;actualFrameSeconds:number[];missing:('start'|'end')[];startWindow:{minimum:number;maximumInclusive:number};endWindow:{minimum:number;maximumExclusive:number};suggestedTimestampsSeconds:number[]}
/** Candidate requests only. Native returned PTS, not requested timestamps, establish coverage. */
export function referenceSampleTimes(range:SelectedReferenceInterval):number[]{const length=range.endExclusive-range.startSeconds;return [range.startSeconds,range.startSeconds+length/2,range.endExclusive-Math.min(.05,length/4)]}
export function referenceCoverageGap(range:SelectedReferenceInterval,frames:readonly Pick<StudioReferenceFrame,'seconds'>[],referenceId?:string):ReferenceCoverageGap|undefined {
 const startWindow={minimum:range.startSeconds-.1,maximumInclusive:range.startSeconds+.2},endWindow={minimum:range.endExclusive-.25,maximumExclusive:range.endExclusive},actualFrameSeconds=frames.map(f=>f.seconds),missing:ReferenceCoverageGap['missing']=[]
 if(!actualFrameSeconds.some(t=>t>=startWindow.minimum&&t<=startWindow.maximumInclusive))missing.push('start')
 if(!actualFrameSeconds.some(t=>t>=endWindow.minimum&&t<endWindow.maximumExclusive))missing.push('end')
 return missing.length?{...range,...(referenceId?{referenceId}:{}),code:'reference-coverage',message:'Reference samples must cover the start and end of the selected source interval, not an unrelated part of the same file.',actualFrameSeconds,missing,startWindow,endWindow,suggestedTimestampsSeconds:referenceSampleTimes(range)}:undefined
}
