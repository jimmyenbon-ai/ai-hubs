import { useState } from 'react'

function SettingsPanel({ onBack }) {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  const [keys, setKeys] = useState([])
  const [values, setValues] = useState({})
  const [saveMsg, setSaveMsg] = useState('')
  const [visibleKeys, setVisibleKeys] = useState({})

  async function handleAuth(e) {
    e.preventDefault()
    setAuthError('')
    setLoading(true)
    try {
      const resp = await fetch('/api/settings/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await resp.json()
      if (data.success) {
        setToken(data.data.token)
        await loadSettings(data.data.token)
      } else {
        setAuthError(data.message || '密码错误')
      }
    } catch (_) {
      setAuthError('网络错误')
    }
    setLoading(false)
  }

  async function loadSettings(t) {
    try {
      const resp = await fetch('/api/settings', {
        headers: { 'x-settings-token': t || token },
      })
      const data = await resp.json()
      if (data.success) {
        setKeys(data.data.keys)
        setValues(data.data.values)
        // 初始化 password 类型字段为不可见
        const hidden = {}
        data.data.keys.forEach((k) => {
          if (k.type === 'password') hidden[k.key] = false
        })
        setVisibleKeys(hidden)
      }
    } catch (_) { /* ignore */ }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaveMsg('')
    setLoading(true)
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-settings-token': token,
        },
        body: JSON.stringify(values),
      })
      const data = await resp.json()
      if (data.success) {
        setSaveMsg('配置已保存并生效')
        setTimeout(() => setSaveMsg(''), 4000)
      } else {
        setSaveMsg('保存失败: ' + (data.message || '未知错误'))
      }
    } catch (_) {
      setSaveMsg('网络错误')
    }
    setLoading(false)
  }

  function updateValue(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function toggleVisibility(key) {
    setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function copyToClipboard(key) {
    const val = values[key] || ''
    if (!val) return
    try {
      await navigator.clipboard.writeText(val)
      setSaveMsg('已复制到剪贴板')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {
      // fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = val
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setSaveMsg('已复制到剪贴板')
      setTimeout(() => setSaveMsg(''), 2000)
    }
  }

  // 未认证 — 显示密码门
  if (!token) {
    return (
      <div className="settings-panel">
        <div className="settings-gate">
          <h2>系统设置</h2>
          <p className="batch-hint">请输入管理密码以访问配置</p>
          <form onSubmit={handleAuth} className="settings-auth-form">
            <input
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoFocus
            />
            {authError && <p className="error-text">{authError}</p>}
            <button type="submit" className="generate-btn" disabled={loading || !password}>
              {loading ? '验证中...' : '进入设置'}
            </button>
          </form>
        </div>
        {onBack && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="btn-outline" onClick={onBack}>返回</button>
          </div>
        )}
      </div>
    )
  }

  // 已认证 — 设置表单
  const groups = {}
  keys.forEach((k) => {
    if (!groups[k.group]) groups[k.group] = []
    groups[k.group].push(k)
  })

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>系统设置</h2>
        {onBack && <button className="btn-outline" onClick={onBack}>返回</button>}
      </div>

      <form onSubmit={handleSave}>
        {Object.entries(groups).map(([group, groupKeys]) => (
          <div key={group} className="settings-group">
            <h3 className="settings-group-title">{group}</h3>
            <div className="settings-fields">
              {groupKeys.map((k) => (
                <div key={k.key} className="settings-field">
                  <label>{k.label}</label>
                  {k.type === 'select' ? (
                    <select
                      className="select-field"
                      value={values[k.key] || ''}
                      onChange={(e) => updateValue(k.key, e.target.value)}
                    >
                      {(k.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : k.type === 'number' ? (
                    <input
                      type="number"
                      className="input-field settings-input"
                      value={values[k.key] || ''}
                      onChange={(e) => updateValue(k.key, e.target.value)}
                    />
                  ) : (
                    <div className="settings-input-row">
                      <input
                        type={k.type === 'password' && !visibleKeys[k.key] ? 'password' : 'text'}
                        className="input-field settings-input"
                        value={values[k.key] || ''}
                        onChange={(e) => updateValue(k.key, e.target.value)}
                        placeholder={k.type === 'password' && !values[k.key] ? '未设置' : ''}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      {k.type === 'password' && (
                        <button
                          type="button"
                          className="settings-icon-btn"
                          onClick={() => toggleVisibility(k.key)}
                          title={visibleKeys[k.key] ? '隐藏' : '显示'}
                        >
                          {visibleKeys[k.key] ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                              <line x1="1" y1="1" x2="23" y2="23"/>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="settings-icon-btn"
                        onClick={() => copyToClipboard(k.key)}
                        title="复制"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {saveMsg && (
          <p className={`settings-save-msg ${saveMsg.includes('失败') || saveMsg.includes('错误') || saveMsg.includes('网络') ? 'error-text' : ''}`}>
            {saveMsg}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="generate-btn" disabled={loading}>
            {loading ? '保存中...' : '保存全部配置'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default SettingsPanel
