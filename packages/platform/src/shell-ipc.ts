import type {IpcMain, IpcMainInvokeEvent, WebContents} from 'electron'

/** All Shell requests pass the same admission before any state or permission change. */
export function createShellIpcRegistrar(ipc: Pick<IpcMain, 'handle'>, getShell: () => WebContents | undefined, trustedURL: string) {
  function admit(event: IpcMainInvokeEvent): void {
    const shell = getShell()
    if (!shell || shell.isDestroyed() || event.sender !== shell || event.senderFrame !== shell.mainFrame ||
        shell.getURL().split('#')[0] !== trustedURL || event.senderFrame.url.split('#')[0] !== trustedURL) {
      throw new Error('BMW_SHELL_IPC_DENIED: Only the trusted BMW Shell main frame may invoke this request.')
    }
  }
  return (channel: string, listener: Parameters<IpcMain['handle']>[1]): void => {
    ipc.handle(channel, (event, ...args: unknown[]) => {admit(event);return listener(event, ...args)})
  }
}
