import { cloneElement, useId } from 'react'
import { Icon } from './Icons'

export function Tool({ icon: Name, title, onClick, disabled, children, primary = false, pressed }) {
  const Component = Icon[Name]
  return <button type="button" title={title} aria-label={title} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={`lit-button ${primary ? 'primary' : ''} ${children ? '' : 'icon-only'}`}>{Component && <Component size={16} />}{children}</button>
}
export function Field({ label, children }) {
  const fieldId = useId()
  return <div className="lit-field"><label htmlFor={fieldId}>{label}</label>{cloneElement(children, { id: fieldId })}</div>
}
