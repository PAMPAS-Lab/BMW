const wsUrl = process.env.BMW_CDP_WS
const expression = process.argv[2]

if (!wsUrl || !expression) {
  console.error('Usage: BMW_CDP_WS=ws://... node scripts/cdp-eval.js <expression>')
  process.exit(2)
}

const socket = new WebSocket(wsUrl)
const timeout = setTimeout(() => {
  console.error('Timed out waiting for BMW CDP')
  socket.close()
  process.exitCode = 1
}, 15_000)

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true }
  }))
})

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== 1) return
  clearTimeout(timeout)
  if (message.error || message.result?.exceptionDetails) {
    console.error(JSON.stringify(message.error ?? message.result.exceptionDetails))
    process.exitCode = 1
  } else {
    const value = message.result?.result?.value
    process.stdout.write(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  socket.close()
})

socket.addEventListener('error', () => {
  clearTimeout(timeout)
  process.exitCode = 1
})
