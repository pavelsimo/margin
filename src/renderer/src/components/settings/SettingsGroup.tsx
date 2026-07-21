import type { ReactNode } from 'react'

interface SettingsGroupProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}

/** A labeled settings section: heading row plus a rounded card of SettingsRow children. */
export function SettingsGroup({ title, description, action, children }: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <div className="settings-group-heading">
        <div className="settings-group-text">
          <span className="settings-group-title">{title}</span>
          {description && <span className="settings-group-desc">{description}</span>}
        </div>
        {action}
      </div>
      <div className="settings-group-card">{children}</div>
    </section>
  )
}

interface SettingsSubheadingProps {
  title: string
  description?: ReactNode
  action?: ReactNode
}

/** A labeled subdivision within one settings card. */
export function SettingsSubheading({ title, description, action }: SettingsSubheadingProps) {
  return (
    <div className="settings-subsection-heading">
      <div className="settings-subsection-text">
        <span className="settings-subsection-title">{title}</span>
        {description && <span className="settings-subsection-desc">{description}</span>}
      </div>
      {action && <div className="settings-subsection-action">{action}</div>}
    </div>
  )
}

interface SettingsRowProps {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
  danger?: boolean
  children?: ReactNode
}

/** One setting inside a group card: text on the left, control on the right, optional detail panel below. */
export function SettingsRow({ title, description, control, danger, children }: SettingsRowProps) {
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className={`settings-row-title${danger ? ' danger' : ''}`}>{title}</span>
          {description && <span className="settings-row-desc">{description}</span>}
        </div>
        {control && <div className="settings-row-control">{control}</div>}
      </div>
      {children && <div className="settings-row-detail">{children}</div>}
    </>
  )
}
