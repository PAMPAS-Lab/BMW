import { agentIdentifier, agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentDriverEvent, AgentRunResult } from '@bmw-agent/agent-contract'

/** Validate the effective SDK init, rather than inferring safety from options. */
export function qoderBrowserCatalog(raw: unknown): { sessionId: string; runtimeVersion: string } {
  const value = agentRecord(raw, 'Qoder initialization')
  if (value.type !== 'system' || value.subtype !== 'init' || value.qodercli_version !== '1.1.64') throw new Error('Unsupported Qoder CN runtime; BMW requires the verified SDK 1.0.50 / runtime 1.1.64 pair')
  if (!Array.isArray(value.tools) || value.tools.length !== 1 || value.tools[0] !== 'browser') throw new Error('Qoder effective model tool catalog must contain exactly BMW browser')
  if (!Array.isArray(value.mcp_servers) || value.mcp_servers.length !== 1) throw new Error('Qoder must connect only the BMW MCP server')
  const server = agentRecord(value.mcp_servers[0])
  if (server.name !== 'bmw' || server.status !== 'connected') throw new Error('Qoder BMW browser MCP did not connect')
  for (const field of ['skills', 'plugins']) if (!Array.isArray(value[field]) || (value[field] as unknown[]).length) throw new Error('Qoder inherited skills/plugins cannot enter the BMW browser runtime')
  return { sessionId: agentIdentifier(value.session_id), runtimeVersion: value.qodercli_version }
}
/** SDK wire messages are provider-owned; BMW persists only normalized display events. */
export class QoderEvents {
  private stream: { modelId: string; ordinal: number; text: Map<number, { id: string; text: string }> } | null = null
  private streamOrdinal = 0
  private readonly completed = new Set<string>()
  private readonly tools = new Set<string>()
  // SDK 1.0.50 may split a single MCP result into text and image User messages.
  private readonly returnedTools = new Map<string, { text: string; images: number }>()
  private accepted = false
  constructor(private readonly runId: string, private readonly messageId: string) {}
  private identity(value: unknown): string { return this.runId + ':' + agentIdentifier(value) }
  async receive(raw: unknown, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult | null> {
    const value = agentRecord(raw, 'Qoder event')
    if (!this.accepted && ['stream_event', 'assistant', 'result'].includes(String(value.type))) {
      // Worker responses prove the UUID-stamped submitted input reached this run.
      this.accepted = true; await emit({ type: 'input.accepted', receiptId: this.messageId })
    }
    if (value.type === 'stream_event') {
      const event = agentRecord(value.event)
      if (event.type === 'message_start') {
        if (this.stream?.text.size) throw new Error('Qoder replaced an unfinished text stream')
        this.stream = { modelId: agentIdentifier(agentRecord(event.message).id), ordinal: ++this.streamOrdinal, text: new Map() }
      }
      if (event.type === 'content_block_start') {
        const block = agentRecord(event.content_block)
        if (block.type === 'text') {
          if (!this.stream || !Number.isSafeInteger(event.index) || Number(event.index) < 0 || this.stream.text.has(Number(event.index))) throw new Error('Invalid Qoder text block identity')
          this.stream.text.set(Number(event.index), { id: this.runId + ':stream-' + this.stream.ordinal + ':' + event.index, text: agentText(block.text, 2 * 1024 * 1024) })
        }
      }
      if (event.type === 'content_block_delta') {
        const delta = agentRecord(event.delta)
        if (delta.type === 'text_delta') {
          const block = this.stream?.text.get(Number(event.index))
          if (!block) throw new Error('Qoder text arrived before its block identity')
          const text = agentText(delta.text, 2 * 1024 * 1024)
          block.text = agentText(block.text + text, 2 * 1024 * 1024)
          await emit({ type: 'message.delta', messageId: block.id, text })
        }
      }
    }
    if (value.type === 'assistant') {
      const message = agentRecord(value.message), id = this.identity(value.uuid)
      if (this.completed.has(id)) throw new Error('Qoder reused a completed assistant identity')
      if (!Array.isArray(message.content)) throw new Error('Invalid Qoder assistant content')
      let textOrdinal = 0
      for (const rawBlock of message.content) {
        const block = agentRecord(rawBlock)
        if (block.type === 'text') {
          const text = agentText(block.text, 2 * 1024 * 1024)
          const entry = this.stream?.modelId === message.id ? this.stream.text.entries().next().value : undefined
          if (entry) {
            const [index, pending] = entry
            if (!text.startsWith(pending.text)) throw new Error('Qoder completed text disagrees with its streamed prefix')
            await emit({ type: 'message.completed', messageId: pending.id, text }); this.stream!.text.delete(index)
          } else await emit({ type: 'message.completed', messageId: id + ':' + textOrdinal, text })
          textOrdinal++
        }
        if (block.type === 'tool_use') {
          if (block.name !== 'browser') throw new Error('Qoder requested an execution tool outside BMW browser')
          const callId = this.identity(block.id), input = agentRecord(block.input)
          if (this.tools.has(callId)) throw new Error('Duplicate Qoder browser call')
          this.tools.add(callId)
          await emit({ type: 'tool.started', callId, name: 'browser', action: agentText(input.action, 200) })
        }
      }
      this.completed.add(id)
    }
    if (value.type === 'user') {
      if (value.uuid === this.messageId && !this.accepted) { this.accepted = true; await emit({ type: 'input.accepted', receiptId: this.messageId }) }
      const message = agentRecord(value.message)
      if (Array.isArray(message.content)) for (const rawBlock of message.content) {
        const block = agentRecord(rawBlock)
        if (block.type !== 'tool_result') continue
        const callId = this.identity(block.tool_use_id)
        const parts = Array.isArray(block.content) ? block.content.map(item => agentRecord(item)) : []
        const imageCount = parts.filter(item => item.type === 'image').length
        const text = typeof block.content === 'string' ? block.content : parts.map(item => item.type === 'text' && typeof item.text === 'string' ? item.text : '').filter(Boolean).join('\n')
        if (!this.tools.delete(callId)) {
          const previous = this.returnedTools.get(callId)
          if (!previous || block.is_error === true || !imageCount || parts.some(item => item.type !== 'image' && item.type !== 'text') || (text && text !== previous.text) || previous.images + imageCount > 24) throw new Error('Qoder result does not belong to a running browser call')
          previous.images += imageCount
          continue
        }
        this.returnedTools.set(callId, { text, images: imageCount })
        // Image blocks remain in the native SDK context. Never stringify pixels into UI logs.
        await emit({ type: 'tool.completed', callId, success: block.is_error !== true, message: text.slice(0, 16384) })
      }
    }
    if (value.type === 'result') {
      if (this.tools.size) throw new Error('Qoder ended before its browser calls returned')
      const failed = value.is_error === true || value.subtype !== 'success'
      const errors = Array.isArray(value.errors) ? value.errors.filter(item => typeof item === 'string').join('\n') : ''
      return { outcome: failed ? 'failed' : 'success', message: failed ? errors.slice(0, 16384) || 'Qoder execution failed' : '' }
    }
    return null
  }
  async interrupted(emit: (event: AgentDriverEvent) => Promise<void>): Promise<void> {
    for (const callId of this.tools) await emit({ type: 'tool.completed', callId, success: false, message: 'Qoder worker stopped; BMW awaits browser cleanup' })
    this.tools.clear()
  }
}
