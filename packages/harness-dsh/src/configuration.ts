import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
export const dshConfiguration=Object.freeze({presetId:'bmw',patchPath:path.join(root,'dsh/base.patch.yml'),presetSourcePath:path.join(root,'dsh/preset/base')})
