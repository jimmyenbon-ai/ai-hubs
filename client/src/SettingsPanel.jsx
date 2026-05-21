import { useState } from 'react'

function SettingsPanel({ onBack }) {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  const [keys, setKeys] = useState([])
  const [values, setValues] = useState({})
  const [saveMsg, setSaveMsg] = useState('')

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
        // 自动加载设置
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
        setTimeout(() => setSaveMsg(''), 3000)
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
                      value={values[k.key] || ''}
                      onChange={(e) => updateValue(k.key, e.target.value)}
                    >
                      {(k.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={k.type === 'password' ? 'password' : 'text'}
                      value={values[k.key] || ''}
                      onChange={(e) => updateValue(k.key, e.target.value)}
                      className="input-field"
                      placeholder={k.type === 'password' ? '••••••••' : ''}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {saveMsg && (
          <p className={`settings-save-msg ${saveMsg.includes('失败') ? 'error-text' : ''}`}>
            {saveMsg}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="generate-btn" disabled={loading}>
            {loading ? '保存中...' : '保存配置'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default SettingsPanel
