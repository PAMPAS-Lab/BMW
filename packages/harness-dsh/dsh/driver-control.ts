import http from 'node:http'
import fs from 'node:fs'

interface Agent {
  session: { header: { id: string; cwd?: string } }
  inbox:{nextTurn:readonly {id:string;source?:{rpcId?:string}}[];nextStep:readonly {id:string;source?:{rpcId?:string}}[];remove(id:string):unknown}
  cancel(cause:{kind:'user'},options:{keepInbox:true}):void
  whenIdle():Promise<void>
}
interface Context {
  agents: { get(id: string): Agent | undefined }
  tools: { schemas(scope: Agent): { name: string; [key: string]: unknown }[] }
  effect(callback: () => () => Promise<void>, label: string): unknown
}
export const inject = ['agents', 'tools']
/** Host control only. Uses the official scoped registry; never a model tool. */
export async function apply(ctx: Context): Promise<void> {
  const file = process.env.BMW_DSH_CONTROL_FILE, token = process.env.BMW_BRIDGE_TOKEN
  if (!file || !token) throw new Error('BMW DSH control configuration is missing')
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    if (request.headers.authorization !== 'Bearer ' + token) { response.writeHead(401); response.end('{}'); return }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'GET' || !['/catalog','/idle','/cancel'].includes(url.pathname)) { response.writeHead(404); response.end('{}'); return }
    const id = url.searchParams.get('sessionId')
    if (!id || id.length > 4096) { response.writeHead(400); response.end('{}'); return }
    const agent = ctx.agents.get(id)
    if (!agent) { response.writeHead(503); response.end('{}'); return }
    try {
      if(url.pathname==='/catalog')response.end(JSON.stringify({ sessionId: agent.session.header.id, directory: agent.session.header.cwd, tools: ctx.tools.schemas(agent) }))
      else{
        let removed=false
        if(url.pathname==='/cancel'){
          const receiptId=url.searchParams.get('receiptId')
          if(!receiptId){response.writeHead(400);response.end('{}');return}
          for(const item of [...agent.inbox.nextTurn,...agent.inbox.nextStep])if(item.source?.rpcId===receiptId){agent.inbox.remove(item.id);removed=true}
          agent.cancel({kind:'user'},{keepInbox:true})
        }
        await agent.whenIdle();response.end(JSON.stringify({sessionId:id,idle:true,removed}))
      }
    }
    catch { response.writeHead(503); response.end('{}') }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('BMW DSH control did not bind localhost')
  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:' + address.port }), { mode: 0o600 })
  ctx.effect(() => async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(file, { force: true }) }, 'bmw-driver.control')
}
