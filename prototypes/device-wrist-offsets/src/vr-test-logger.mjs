const endpoint = '/__vr-test-log'

export function createVrTestLogger(context) {
  const sessionId = crypto.randomUUID()
  let sequence = 0

  function record(type, details = {}) {
    const body = JSON.stringify({
      sessionId,
      sequence: sequence++,
      clientAt: new Date().toISOString(),
      context,
      type,
      details,
    })

    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  }

  return { record }
}

export function captureBrowserErrors(logger) {
  window.addEventListener('error', (event) => {
    logger.record('window.error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? { name: event.reason.name, message: event.reason.message, stack: event.reason.stack }
      : String(event.reason)
    logger.record('window.unhandledrejection', { reason })
  })
}
