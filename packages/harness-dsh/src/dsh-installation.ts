import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require=createRequire(import.meta.url)
/** The lockfile-owned official runtime; never drift to a global PATH copy. */
export function bundledDshCli():string {
 const manifest=require.resolve('@deepseek-ai/dsh/package.json'),file=path.join(path.dirname(manifest),'lib','bin.js')
 if(!fs.statSync(file).isFile())throw new Error('Install the pinned BMW DSH dependency.')
 return fs.realpathSync(file)
}
