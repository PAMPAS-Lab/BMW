import type { NarrationBridge, NarrationRequest } from '../narration-contract.js'
import { assertNarration } from '../narration-contract.js'
declare global { interface Window { bmwNarration: NarrationBridge } }
// Public protocol identifiers from rany2/edge-tts constants.py (2026-10-02).
// This is an experimental consumer service, not a supported Azure API.
const client = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
function xml(value: string): string { return value.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[value]!)) }
async function speak(token: string, raw: NarrationRequest): Promise<void> {
  let socket: WebSocket | undefined
  try {
    const request = assertNarration(raw)
    const seconds = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300
    const ticks = BigInt(seconds) * 10000000n
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(ticks) + client))
    const signature = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('').toUpperCase()
    const id = crypto.randomUUID().replaceAll('-', '')
    socket = new WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${client}&ConnectionId=${id}&Sec-MS-GEC=${signature}&Sec-MS-GEC-Version=1-143.0.3650.75`)
    socket.binaryType = 'arraybuffer'
    const chunks: Uint8Array[] = []; let size = 0
    const ws = socket
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error('Experimental Edge TTS connection failed.'))
      ws.onclose = () => reject(new Error('TTS connection ended before turn.end.'))
      ws.onopen = () => {
        const timestamp = new Date().toUTCString()
        ws.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } })}`)
        const rate = `${request.ratePercent >= 0 ? '+' : ''}${request.ratePercent}%`
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${request.voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${xml(request.text)}</prosody></voice></speak>`
        ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`)
      }
      ws.onmessage = event => {
        try {
          if (typeof event.data === 'string') { if (event.data.includes('Path:turn.end')) resolve(); return }
          const data = new Uint8Array(event.data as ArrayBuffer)
          if (data.length < 2) throw new Error('Malformed TTS audio frame.')
          const headerLength = (data[0] << 8) | data[1]
          if (headerLength + 2 > data.length) throw new Error('Truncated TTS audio frame.')
          const header = new TextDecoder().decode(data.subarray(2, 2 + headerLength))
          if (!header.includes('Path:audio')) return
          const audio = data.slice(2 + headerLength)
          size += audio.length; if (size > 8 * 1024 * 1024) throw new Error('Narration exceeds 8 MiB.')
          if (audio.length) chunks.push(audio)
        } catch (error) { reject(error) }
      }
    })
    if (!size) throw new Error('TTS returned no speech; no silent substitute was produced.')
    const data = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
    window.bmwNarration.reply({ token, data })
  } catch (error) { window.bmwNarration.reply({ token, error: error instanceof Error ? error.message : String(error) }) }
  finally { socket?.close() }
}
window.bmwNarration.onCommand(value => { void speak(value.token, value.request) })
