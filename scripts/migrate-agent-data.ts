import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {acquireAgentDataLock} from '@bmw-agent/platform/agent-data'
import {readDshProfileForMigration} from '@bmw-agent/harness-dsh/migration'
import {BrowserCapabilityRegistry} from '@bmw-agent/browser-capability/registry'
import {bmwProduct} from '@bmw-agent/product-bmw'
import {migrationProjects,planAgentDataMigration,applyAgentDataMigration} from './agent-data-migration.js'

const args=process.argv.slice(2),profileAt=args.indexOf('--profile')
if(profileAt<0||!args[profileAt+1]||args.some((arg,index)=>index!==profileAt+1&&!['--profile','--plan','--apply'].includes(arg))||args.includes('--plan')&&args.includes('--apply'))throw new Error('Usage: npm run migrate:agent-data -- --profile <absolute Profile path> [--plan|--apply]')
if(!path.isAbsolute(args[profileAt+1]))throw new Error('The BMW Profile path must be absolute')
const profile=fs.realpathSync(args[profileAt+1]),release=acquireAgentDataLock(profile)
try {
  const marker=path.join(profile,'agent-data-version.json'),current=fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).version===2
  const projects=migrationProjects(profile),bound=projects.filter(row=>row.binding.workspaceId||row.binding.sessionId)
  const native=current||!bound.length?[]:await readDshProfileForMigration({profileDirectory:profile,projects:bound.map(row=>({...row,...row.binding,archivedProject:row.archivedAt!==null})),mcpServerPath:fileURLToPath(new URL('../packages/browser-capability/src/browser-mcp-server.js',import.meta.url)),toolDefinition:new BrowserCapabilityRegistry(bmwProduct).toolDefinition()},AbortSignal.timeout(5*60*1000))
  const plan=planAgentDataMigration(profile,native)
  if(args.includes('--apply')){
    const backup=path.join(path.dirname(profile),path.basename(profile)+'-agent-data-backup-'+Date.now())
    const result=applyAgentDataMigration(plan,backup)
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  }else process.stdout.write(JSON.stringify({mode:'plan',report:plan.report},null,2)+'\n')
}finally{release()}
