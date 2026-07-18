import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { safeResolve, UPLOADS_ROOT } from './paths'

// margin://uploads/docs/1/pages/3.png → DATA_ROOT/uploaded_files/docs/1/pages/3.png
// Registered before app.ready so the renderer can use it like any http origin.
export function registerMarginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'margin', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ])
}

export function installMarginProtocol(): void {
  protocol.handle('margin', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'uploads') return new Response('not found', { status: 404 })
    try {
      const filePath = safeResolve(UPLOADS_ROOT, decodeURIComponent(url.pathname).replace(/^\//, ''))
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('forbidden', { status: 403 })
    }
  })
}

export function pageImageUrl(imagePath: string): string {
  return `margin://uploads/${imagePath}`
}
