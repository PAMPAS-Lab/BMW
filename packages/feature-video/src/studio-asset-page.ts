import fs from 'node:fs'
import path from 'node:path'
import {assertAssetQuery,studioPage} from './studio-read-contract.js'
import type {StudioAsset} from './studio-contract.js'
/** Filter all names before pagination. Review outputs cannot hide late materials. */
export function studioAssetPage(projectDirectory:string,raw:unknown) {
 const query=assertAssetQuery(raw),expected=path.join(fs.realpathSync(projectDirectory),'artifacts'),directory=fs.realpathSync(expected)
 if(directory!==expected||fs.lstatSync(expected).isSymbolicLink())throw new Error('Assets must stay inside their Project.')
 const rows:StudioAsset[]=[]
 for(const artifactId of fs.readdirSync(directory).sort()){
  if(query.query&&!artifactId.toLocaleLowerCase().includes(query.query.toLocaleLowerCase()))continue
  if(!query.includeReviewArtifacts&&/^(?:media-[a-f0-9-]+-frame-\d+\.png|video-[a-f0-9-]+\.json)$/i.test(artifactId))continue
  const extension=path.extname(artifactId).toLowerCase(),kind:StudioAsset['kind']|undefined=['.png','.jpg','.jpeg','.webp'].includes(extension)?'image':['.wav','.mp3','.ogg','.flac','.m4a'].includes(extension)?'audio':['.mp4','.webm','.mov','.mkv'].includes(extension)?'video':['.txt','.md','.srt','.vtt','.json'].includes(extension)?'text':undefined
  if(!kind||query.kind&&kind!==query.kind)continue
  const stat=fs.lstatSync(path.join(directory,artifactId));if(!stat.isFile()||stat.isSymbolicLink())continue
  rows.push({artifactId,bytes:stat.size,kind,modifiedAt:stat.mtime.toISOString()})
 }
 const {items,...page}=studioPage(rows,query.offset,query.limit)
 return {assets:items,...page,filters:query,order:'artifactId',grouping:'filename-pattern-only',sourceDiscovery:'Stored web originals use source/list and source/read; read-material reads artifact text only.'}
}
