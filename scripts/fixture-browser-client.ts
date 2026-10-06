import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import readline from 'node:readline'
export interface FixtureBrowserConnection {bridgeUrl:string;bridgeToken:string;mcpServerPath:string;binding?:string;driverId?:string}

export function fixtureRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected a fixture protocol object')
  return value as Record<string, unknown>
}
/** A model-side MCP client for contract tests. It starts only BMW's MCP adapter;
 * no DSH process, model, Agent loop or external service is loaded. */
export function createFixtureBrowserClient(config: FixtureBrowserConnection) {
  const child = spawn(process.execPath, [config.mcpServerPath], {
    env: {...process.env, ELECTRON_RUN_AS_NODE:'1', BMW_BRIDGE_URL:config.bridgeUrl, BMW_BRIDGE_TOKEN:config.bridgeToken,...(config.binding?{BMW_SESSION_BINDING:config.binding,BMW_CATALOG_ONLY:''}:{BMW_SESSION_BINDING:'',BMW_CATALOG_ONLY:'1'})},
    stdio:['pipe','pipe','pipe']
  })
  let sequence = 0, stderr = '', ended = false
  const pending = new Map<number,{resolve(value:unknown):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>()
  const lines = readline.createInterface({input:child.stdout,crlfDelay:Infinity})
  function fail(error: Error): void {
    ended = true
    for (const call of pending.values()) {clearTimeout(call.timer);call.reject(error)}
    pending.clear()
  }
  child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-8192)})
  child.once('error',fail)
  child.once('exit',()=>fail(new Error('Fixture MCP adapter exited: '+stderr)))
  lines.on('line',line=>{
    try {
      const message=fixtureRecord(JSON.parse(line))
      assert.equal(message.jsonrpc,'2.0')
      assert.equal(typeof message.id,'number')
      const call=pending.get(message.id as number)
      assert.ok(call,'Unexpected fixture MCP reply')
      const failure=message.error?new Error(String(fixtureRecord(message.error).message)):undefined
      pending.delete(message.id as number);clearTimeout(call.timer)
      if(failure)call.reject(failure)
      else call.resolve(message.result)
    } catch(error) {fail(error instanceof Error?error:new Error(String(error)))}
  })
  async function request(method:string,params:unknown={}):Promise<unknown> {
    if(ended)throw new Error('Fixture MCP adapter is closed: '+stderr)
    const id=++sequence
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Fixture MCP request timed out: '+method))},15000)
      pending.set(id,{resolve,reject,timer})
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')
    })
  }
  async function post(endpoint:string,input:unknown):Promise<Record<string,unknown>> {
    const response=await fetch(config.bridgeUrl+endpoint,{method:'POST',headers:{authorization:'Bearer '+config.bridgeToken,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)})
    const value=fixtureRecord(await response.json())
    if(!response.ok)throw new Error(String(value.error))
    return value
  }
  async function register(sessionId:string,directory:string):Promise<string> {
    const reply=await post('/session/register',{sessionId,directory,driverId:config.driverId??'fixture'})
    assert.equal(typeof reply.binding,'string');assert.ok(reply.binding)
    return reply.binding as string
  }
  return {request,post,register,
    async call(binding:string,argumentsValue:Record<string,unknown>):Promise<Record<string,unknown>> {
      if(config.binding===binding)return fixtureRecord(await request('tools/call',{name:'browser',arguments:argumentsValue}))
      const scoped=createFixtureBrowserClient({...config,binding})
      try{return fixtureRecord(await scoped.request('tools/call',{name:'browser',arguments:argumentsValue}))}finally{await scoped.close()}
    },
    async close():Promise<void> {
      lines.close();fail(new Error('Fixture MCP client closed'))
      if(child.exitCode===null && child.signalCode===null){
        const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()))
        child.kill('SIGTERM')
        const timer=setTimeout(()=>child.kill('SIGKILL'),2000)
        await closed;clearTimeout(timer)
      }
    }
  }
}
