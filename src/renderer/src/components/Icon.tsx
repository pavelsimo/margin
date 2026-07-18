import type { SVGProps } from 'react'

type IconName =
  | 'panel'
  | 'back'
  | 'forward'
  | 'home'
  | 'library'
  | 'plus'
  | 'search'
  | 'settings'
  | 'assistant'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'check'
  | 'link'
  | 'paperclip'

export default function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  let body
  switch (name) {
    case 'panel':
      body = <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M9 3v18" /></>
      break
    case 'back':
      body = <><path d="m15 18-6-6 6-6" /></>
      break
    case 'forward':
      body = <><path d="m9 18 6-6-6-6" /></>
      break
    case 'home':
      body = <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>
      break
    case 'library':
      body = <><path d="M4 19.5V6.7A2.7 2.7 0 0 1 6.7 4H20v15.5H6.7A2.7 2.7 0 0 0 4 22.2" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20" /></>
      break
    case 'plus':
      body = <><path d="M12 5v14M5 12h14" /></>
      break
    case 'search':
      body = <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>
      break
    case 'settings':
      body = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>
      break
    case 'assistant':
      body = <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M15 3v18M7 9h4M7 13h4" /></>
      break
    case 'minimize':
      body = <><path d="M5 12h14" /></>
      break
    case 'maximize':
      body = <><rect x="5" y="5" width="14" height="14" rx="1" /></>
      break
    case 'restore':
      body = <><rect x="7" y="7" width="12" height="12" rx="1" /><path d="M7 16H5V5h11v2" /></>
      break
    case 'close':
      body = <><path d="m6 6 12 12M18 6 6 18" /></>
      break
    case 'check':
      body = <><path d="m5 12 4 4L19 6" /></>
      break
    case 'link':
      body = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></>
      break
    case 'paperclip':
      body = <><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 1 1 5.66 5.66l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></>
      break
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {body}
    </svg>
  )
}
