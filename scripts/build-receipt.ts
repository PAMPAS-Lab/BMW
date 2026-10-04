import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root=process.cwd(),sources:Record<string,string>={},outputs:Record<string,string>={}
function walk(directory:string):void{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name)
  if(entry.isDirectory()){walk(file);continue}
  if(!/\.(ts|cts|mts|html|css|json|yml)$/.test(file))continue
  const relative=path.relative(root,file).split(path.sep).join('/')
  sources[relative]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if(!file.endsWith('.d.ts')&&/\.(ts|cts|mts)$/.test(file)){
    const emitted=file.replace(/\.ts$/,'.js').replace(/\.cts$/,'.cjs').replace(/\.mts$/,'.mjs')
    outputs[path.relative(root,emitted).split(path.sep).join('/')]=crypto.createHash('sha256').update(fs.readFileSync(emitted)).digest('hex')
  }
}}
for(const directory of ['apps','packages','scripts','types'])walk(path.join(root,directory))
for(const file of ['package.json','package-lock.json','tsconfig.json'])sources[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.mkdirSync(path.join(root,'.bmw-runtime'),{recursive:true})
fs.writeFileSync(path.join(root,'.bmw-runtime/build-receipt.json'),JSON.stringify({node:process.version,sources,outputs},null,2)+'\n')
