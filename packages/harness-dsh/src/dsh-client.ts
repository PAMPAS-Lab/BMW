import type { AgentClient, AgentClientSurface } from '@bmw-agent/agent-contract'
import { selectedDshSession } from './dsh-context.js'
export const dshClient:AgentClient={
 async readSelection(surface,runtimeUrl){
  if(surface.isDestroyed()||new URL(surface.getURL()).origin!==new URL(runtimeUrl).origin)return null
  return selectedDshSession(await surface.executeJavaScript('localStorage.getItem("dsh.sessions.current")'))
 },
 async selectSession(surface,sessionId,reload=true){
  if(surface.isDestroyed())return
  await surface.executeJavaScript("localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:"+JSON.stringify(sessionId)+"}));"+(reload?'location.reload()':''))
 },
 async applySidebarPolicy(surface,visible){
  if(surface.isDestroyed())return
  await surface.executeJavaScript(`(() => {
    const visible = ${JSON.stringify(visible)}
    const styleId = 'bmw-dsh-sidebar-policy'
    let style = document.getElementById(styleId)
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = '[data-bmw-sidebar-hidden] > :first-child{visibility:hidden!important;pointer-events:none!important;border-right:0!important}[data-bmw-sidebar-hidden] > [data-side="sidebar"]{display:none!important}[data-bmw-sidebar-hidden]{grid-template-columns:0px minmax(0,1fr) var(--bmw-dsh-details-width,0px)!important}'
    const apply = () => {
      const overlay = document.querySelector('[data-shell-overlay]')
      const frame = overlay?.parentElement
      if (!frame) return
      const match = /([0-9.]+)px\\s*$/.exec(frame.style.gridTemplateColumns || '')
      if (match) frame.style.setProperty('--bmw-dsh-details-width', match[1] + 'px')
      frame.toggleAttribute('data-bmw-sidebar-hidden', !visible)
    }
    window.__bmwApplySidebarPolicy = apply
    apply()
    window.__bmwSidebarObserver?.disconnect?.()
    window.__bmwSidebarObserver = new MutationObserver(apply)
    window.__bmwWatchSidebarPolicy = () => window.__bmwSidebarObserver.observe(document.documentElement, { childList: true, subtree: true })
    window.__bmwWatchSidebarPolicy()
    return { visible, applied: Boolean(document.querySelector('[data-shell-overlay]')?.parentElement) }
  })()`)
 },
 async openSettings(surface:AgentClientSurface){
  const opened = await surface.executeJavaScript(`(() => {
    window.__bmwSidebarObserver?.disconnect?.()
    document.querySelector('[data-shell-overlay]')?.parentElement?.removeAttribute('data-bmw-sidebar-hidden')
    const buttons = [...document.querySelectorAll('button')]
    const trigger = buttons.find((button) => ['Settings', '设置'].includes((button.getAttribute('aria-label') || button.textContent || '').trim()))
    if (!trigger) {
      window.__bmwApplySidebarPolicy?.()
      window.__bmwWatchSidebarPolicy?.()
      return false
    }
    trigger.click()
    let sawSettings = document.querySelector('[aria-modal="true"]') !== null
    const timer = window.setInterval(() => {
      const settingsOpen = document.querySelector('[aria-modal="true"]') !== null
      sawSettings ||= settingsOpen
      if (!sawSettings || settingsOpen) return
      window.clearInterval(timer)
      window.__bmwApplySidebarPolicy?.()
      window.__bmwWatchSidebarPolicy?.()
    }, 200)
    return true
  })()`)
  if (!opened) throw new Error('DSH advanced settings are not available yet.')
 }
}
