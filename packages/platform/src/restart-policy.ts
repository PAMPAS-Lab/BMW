export interface RestartActivity {
  mediaCaptureActive?: boolean
  scheduledTaskActive?: boolean
  validationRunActive?: boolean
}

export interface RestartBlock {
  code: 'media-capture-active' | 'scheduled-task-active' | 'validation-run-active'
  message: string
}

/**
 * Return the first activity that must reach a durable boundary before BMW can
 * safely relaunch. Queued and approval-only work is intentionally restartable.
 */
export function restartBlockReason(activity: RestartActivity): RestartBlock | null {
  if (activity.mediaCaptureActive) {
    return {
      code: 'media-capture-active',
      message: 'A screen recording or media capture is still active. Stop it before restarting BMW.'
    }
  }
  if (activity.scheduledTaskActive) {
    return {
      code: 'scheduled-task-active',
      message: 'BMW is running a scheduled task. Wait for it to finish before restarting.'
    }
  }
  if (activity.validationRunActive) {
    return {
      code: 'validation-run-active',
      message: 'BMWDev is running a Web Validation Loop. Stop it or wait for it to finish before restarting.'
    }
  }
  return null
}
