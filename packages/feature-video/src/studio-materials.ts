import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import type {StudioAsset, VideoDraft} from './studio-contract.js'

export interface AssetUsage {draftId:string;sceneId:string;label:string}
export interface MaterialEntry {asset:StudioAsset;usage:AssetUsage[]}
/** Current in-memory edits replace their persisted snapshot when calculating usage. */
export function groupMaterials(assets:StudioAsset[], drafts:VideoDraft[], current:VideoDraft, sceneId:string):Record<'current'|'unused'|'elsewhere',MaterialEntry[]> {
  const usage=new Map<string,AssetUsage[]>()
  for(const draft of [...drafts.filter(item=>item.id!==current.id),current])for(const [index,scene] of draft.scenes.entries()){
    for(const id of new Set([...sceneVisuals(scene).flatMap(segment=>[segment.imageArtifactId,segment.videoArtifactId]),scene.audioArtifactId].filter((id):id is string=>Boolean(id)))){
      const refs=usage.get(id)??[];refs.push({draftId:draft.id,sceneId:scene.id,label:`${draft.title} · ${index+1} ${scene.title}`});usage.set(id,refs)
    }
  }
  const groups:ReturnType<typeof groupMaterials>={current:[],unused:[],elsewhere:[]}
  for(const asset of assets){const refs=usage.get(asset.artifactId)??[];const key=refs.some(ref=>ref.draftId===current.id&&ref.sceneId===sceneId)?'current':refs.length?'elsewhere':'unused';groups[key].push({asset,usage:refs})}
  return groups
}
export const MATERIAL_DRAG_TYPE='application/x-bmw-studio-material'
export function parseMaterialDrop(raw:string,projectId:string,assets:StudioAsset[],slot?:'visual'|'audio'):StudioAsset|undefined {
  if(raw.length>1024)return
  try{const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return
    const item=value as Record<string,unknown>;if(Object.keys(item).some(key=>!['projectId','artifactId'].includes(key))||item.projectId!==projectId||typeof item.artifactId!=='string')return
    const asset=assets.find(asset=>asset.artifactId===item.artifactId)
    if(!asset||asset.kind==='text'||(slot==='audio'&&asset.kind!=='audio')||(slot==='visual'&&asset.kind==='audio'))return
    return asset
  }catch{return}
}
