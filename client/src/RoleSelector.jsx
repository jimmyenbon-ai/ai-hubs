import { useState, useEffect } from 'react';
import { Icon } from './components/Icons';

const ICON_MAP = {
  palette: Icon.Palette,
  pen: Icon.Pen,
  video: Icon.Video,
  cube: Icon.Cube,
  house: Icon.House,
  brain: Icon.Brain,
  bot: Icon.Bot,
  user: Icon.User,
};

function getRoleIcon(iconKey, size = 16) {
  const Comp = ICON_MAP[iconKey];
  return Comp ? <Comp size={size} /> : <Icon.User size={size} />;
}

export default function RoleSelector({ currentRole, onRoleChange }) {
  const [roles, setRoles] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/roles')
      .then(r => r.json())
      .then(d => { if (d.success) setRoles(d.data); })
      .catch(() => {});
  }, []);

  const current = roles.find(r => r.id === currentRole) || roles[0];

  return (
    <div className="role-selector" style={{ padding: '8px 10px', position: 'relative' }}>
      <div
        className="role-selector-trigger"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ fontSize: 18 }}>
          {current ? getRoleIcon(current.icon, 18) : <Icon.User size={18} />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
          {current ? current.name : '选择角色'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6,9 12,15 18,9"/>
        </svg>
      </div>

      {open && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }}
            onClick={() => setOpen(false)}
          />
          <div className="role-selector-menu" style={{
            position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 99,
            background: 'var(--bg-panel)', borderRadius: 8,
            border: '1px solid var(--border-light)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden', marginTop: 4,
          }}>
            {roles.map(role => (
              <div
                key={role.id}
                onClick={() => { onRoleChange(role.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', cursor: 'pointer', fontSize: 13,
                  color: 'var(--text-main)',
                  background: currentRole === role.id ? 'var(--primary-glow)' : 'transparent',
                  borderLeft: currentRole === role.id ? '2px solid var(--primary-color)' : '2px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (currentRole !== role.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (currentRole !== role.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 16 }}>{getRoleIcon(role.icon, 16)}</span>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{role.name}</div>
                  {role.description && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>{role.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
