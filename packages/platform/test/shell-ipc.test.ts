import assert from 'node:assert/strict'
import test from 'node:test'
import type {IpcMain, IpcMainInvokeEvent, WebContents} from 'electron'
import {createShellIpcRegistrar} from '../src/shell-ipc.js'

test('Shell IPC admits only its trusted live main frame before invoking any privileged handler', async () => {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const ipc: Pick<IpcMain,'handle'> = {handle(channel, listener) {handlers.set(channel, listener)}}
  const url = 'file:///isolated/bmw/shell.html', frame = {url}, child = {url}
  let currentURL = url, destroyed = false, calls = 0
  const shell = {mainFrame: frame, isDestroyed: () => destroyed, getURL: () => currentURL} as unknown as WebContents
  let active: WebContents | undefined = shell
  const register = createShellIpcRegistrar(ipc, () => active, url)
  register('mutate', (_event, value: unknown) => {calls++;return {value}})
  const invoke = (sender: unknown, senderFrame: unknown) => Promise.resolve().then(() => handlers.get('mutate')!({sender, senderFrame} as IpcMainInvokeEvent, 'exact payload'))
  assert.deepEqual(await invoke(shell, frame), {value: 'exact payload'})
  currentURL = url+'#settings';frame.url = currentURL
  assert.deepEqual(await invoke(shell, frame), {value: 'exact payload'})
  for (const [sender, senderFrame] of [[{}, frame], [shell, child], [shell, null]]) await assert.rejects(invoke(sender, senderFrame), /BMW_SHELL_IPC_DENIED/)
  active = undefined;await assert.rejects(invoke(shell, frame), /BMW_SHELL_IPC_DENIED/);active = shell
  destroyed = true;await assert.rejects(invoke(shell, frame), /BMW_SHELL_IPC_DENIED/);destroyed = false
  currentURL = 'https://foreign.example/';await assert.rejects(invoke(shell, frame), /BMW_SHELL_IPC_DENIED/)
  currentURL = url;frame.url = 'about:blank';await assert.rejects(invoke(shell, frame), /BMW_SHELL_IPC_DENIED/)
  assert.equal(calls, 2, 'Rejected requests never invoke application code')
})
