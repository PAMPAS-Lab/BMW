import fs from 'node:fs'
/** A fixed bundled skill is prompt guidance; runtime catalog admission is separate. */
export function qoderBmwGuidance():string{
  const source=fs.readFileSync(new URL('../qoder-bmw/SKILL.md',import.meta.url),'utf8')
  const end=source.indexOf('\n---\n',4)
  if(!source.startsWith('---\n')||end<0||Buffer.byteLength(source)>16384)throw new Error('Invalid bundled qoder-bmw guidance')
  return source.slice(end+5).trim()
}
