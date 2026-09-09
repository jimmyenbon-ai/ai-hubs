import { useState } from 'react'

const PROFILE_TEMPLATE = {
  name: '',
  scope: 'personal',
  notes: '',
  llm: {
    provider: 'deepseek',
    api_url: 'https://api.deepseek.com',
    api_key: '',
    model: 'deepseek-chat',
  },
  grsai: {
    api_host: 'https://grsai.dakka.com.cn',
    api_key: '',
  },
  is_active: false,
}

const LLM_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { id: 'ollama', label: 'Ollama 本地', url: 'http://localhost:11434', model: 'llama3' },
]

function cloneProfile(profile = PROFILE_TEMPLATE) {
  return {
    ...PROFILE_TEMPLATE,
    ...profile,
    llm: { ...PROFILE_TEMPLATE.llm, ...(profile.llm || {}) },
    grsai: { ...PROFILE_TEMPLATE.grsai, ...(profile.grsai || {}) },
  }
}

function maskKey(value) {
  if (!value) return '未设置'
  return `••••••••${value.slice(-4)}`
}

function SettingsPanel({ onBack }) {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('profiles')

  const [keys, setKeys] = useState([])
  const [values, setValues] = useState({})
  const [saveMsg, setSaveMsg] = useState('')
  const [visibleKeys, setVisibleKeys] = useState({})

  const [profiles, setProfiles] = useState([])
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState(null)
  const [profileForm, setProfileForm] = useState(cloneProfile())
  const [visibleProfileKeys, setVisibleProfileKeys] = useState({})
  const [profileMsg, setProfileMsg] = useState('')
  const [profileBusy, setProfileBusy] = useState('')

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
        await Promise.all([loadSettings(data.data.token), loadProfiles(data.data.token)])
      } else {
        setAuthError(data.message || '密码错误')
      }
    } catch {
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
        const hidden = {}
        data.data.keys.forEach((k) => {
          if (k.type === 'password') hidden[k.key] = false
        })
        setVisibleKeys(hidden)
      }
    } catch { /* ignore */ }
  }

  async function loadProfiles(t) {
    try {
      const resp = await fetch('/api/api-key-profiles', {
        headers: { 'x-settings-token': t || token },
      })
      const data = await resp.json()
      if (data.success) setProfiles(data.data || [])
    } catch { /* ignore */ }
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
    } catch {
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

  function toggleProfileKey(key) {
    setVisibleProfileKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function updateProfileField(key, value) {
    setProfileForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateProfileNested(section, key, value) {
    setProfileForm((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }))
  }

  function handleProviderChange(providerId) {
    const provider = LLM_PROVIDERS.find((item) => item.id === providerId)
    setProfileForm((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        provider: providerId,
        api_url: provider?.url || prev.llm.api_url,
        model: provider?.model || prev.llm.model,
      },
    }))
  }

  function openCreateProfile() {
    setEditingProfileId(null)
    setProfileForm(cloneProfile({ is_active: profiles.length === 0 }))
    setVisibleProfileKeys({})
    setProfileMsg('')
    setShowProfileForm(true)
  }

  function openEditProfile(profile) {
    setEditingProfileId(profile.id)
    setProfileForm(cloneProfile(profile))
    setVisibleProfileKeys({})
    setProfileMsg('')
    setShowProfileForm(true)
  }

  async function saveProfile() {
    if (!profileForm.name.trim()) {
      setProfileMsg('请填写配置名称')
      return
    }
    setProfileBusy('save')
    setProfileMsg('')
    try {
      const resp = await fetch(editingProfileId ? `/api/api-key-profiles/${editingProfileId}` : '/api/api-key-profiles', {
        method: editingProfileId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-settings-token': token,
        },
        body: JSON.stringify(profileForm),
      })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '保存失败')
      await Promise.all([loadProfiles(token), loadSettings(token)])
      setShowProfileForm(false)
      setProfileMsg('')
    } catch (err) {
      setProfileMsg(err.message || '保存失败')
    }
    setProfileBusy('')
  }

  async function activateProfile(id) {
    setProfileBusy(id)
    setProfileMsg('')
    try {
      const resp = await fetch(`/api/api-key-profiles/${id}/activate`, {
        method: 'POST',
        headers: { 'x-settings-token': token },
      })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '切换失败')
      await Promise.all([loadProfiles(token), loadSettings(token)])
      setProfileMsg('已切换当前 API Key 配置')
      setTimeout(() => setProfileMsg(''), 3000)
    } catch (err) {
      setProfileMsg(err.message || '切换失败')
    }
    setProfileBusy('')
  }

  async function deleteProfile(id) {
    if (!confirm('确定删除这个 API Key 配置档？')) return
    setProfileBusy(id)
    setProfileMsg('')
    try {
      const resp = await fetch(`/api/api-key-profiles/${id}`, {
        method: 'DELETE',
        headers: { 'x-settings-token': token },
      })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '删除失败')
      await loadProfiles(token)
    } catch (err) {
      setProfileMsg(err.message || '删除失败')
    }
    setProfileBusy('')
  }

  async function copyToClipboard(key) {
    const val = values[key] || ''
    if (!val) return
    try {
      await navigator.clipboard.writeText(val)
      setSaveMsg('已复制到剪贴板')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {
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

      <div className="settings-tabs">
        <button type="button" className={activeTab === 'profiles' ? 'active' : ''} onClick={() => setActiveTab('profiles')}>
          API Key 配置档
        </button>
        <button type="button" className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
          基础设置
        </button>
      </div>

      {activeTab === 'profiles' && (
        <div className="api-profile-panel">
          <div className="api-profile-toolbar">
            <div>
              <h3>API Key 配置档</h3>
              <p>保存公司/个人项目的 LLM 和 GRSai Key，按需切换当前生效配置。</p>
            </div>
            <button type="button" className="generate-btn" onClick={openCreateProfile}>添加配置档</button>
          </div>

          {profileMsg && (
            <p className={`settings-save-msg ${profileMsg.includes('失败') || profileMsg.includes('请') ? 'error-text' : ''}`}>
              {profileMsg}
            </p>
          )}

          {profiles.length === 0 ? (
            <div className="api-profile-empty">暂无配置档，添加公司或个人 API Key 后即可一键切换。</div>
          ) : (
            <div className="api-profile-list">
              {profiles.map((profile) => (
                <div key={profile.id} className={`api-profile-card ${profile.is_active === 1 ? 'active' : ''}`}>
                  <div className="api-profile-card-head">
                    <div>
                      <div className="api-profile-title-row">
                        <strong>{profile.name}</strong>
                        {profile.is_active === 1 && <span>当前生效</span>}
                        <small>{profile.scope === 'company' ? '公司项目' : profile.scope === 'personal' ? '个人项目' : profile.scope}</small>
                      </div>
                      {profile.notes && <p>{profile.notes}</p>}
                    </div>
                    <div className="api-profile-actions">
                      {profile.is_active !== 1 && (
                        <button type="button" className="btn-outline" disabled={profileBusy === profile.id} onClick={() => activateProfile(profile.id)}>
                          {profileBusy === profile.id ? '切换中...' : '启用'}
                        </button>
                      )}
                      <button type="button" className="btn-outline" onClick={() => openEditProfile(profile)}>编辑</button>
                      <button type="button" className="btn-outline danger" disabled={profileBusy === profile.id} onClick={() => deleteProfile(profile.id)}>删除</button>
                    </div>
                  </div>
                  <div className="api-profile-meta">
                    <div><label>LLM</label><span>{profile.llm.provider} · {profile.llm.model}</span></div>
                    <div><label>LLM Key</label><span>{maskKey(profile.llm.api_key)}</span></div>
                    <div><label>GRSai</label><span>{profile.grsai.api_host}</span></div>
                    <div><label>GRSai Key</label><span>{maskKey(profile.grsai.api_key)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
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
                            {visibleKeys[k.key] ? '隐' : '显'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="settings-icon-btn"
                          onClick={() => copyToClipboard(k.key)}
                          title="复制"
                        >
                          复
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
      )}

      {showProfileForm && (
        <div className="modal-backdrop" onClick={() => setShowProfileForm(false)}>
          <div className="modal-content api-profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editingProfileId ? '编辑 API Key 配置档' : '添加 API Key 配置档'}</span>
              <button className="btn-back" type="button" onClick={() => setShowProfileForm(false)}>×</button>
            </div>

            <div className="api-profile-form">
              <div className="api-profile-grid">
                <div className="settings-field">
                  <label>配置名称 *</label>
                  <input className="input-field" value={profileForm.name} onChange={(e) => updateProfileField('name', e.target.value)} placeholder="例如：公司项目 / 个人项目" />
                </div>
                <div className="settings-field">
                  <label>用途</label>
                  <select className="input-field" value={profileForm.scope} onChange={(e) => updateProfileField('scope', e.target.value)}>
                    <option value="company">公司项目</option>
                    <option value="personal">个人项目</option>
                    <option value="test">测试环境</option>
                  </select>
                </div>
              </div>

              <div className="settings-field">
                <label>备注</label>
                <input className="input-field" value={profileForm.notes} onChange={(e) => updateProfileField('notes', e.target.value)} placeholder="可写账号来源、适用项目或注意事项" />
              </div>

              <div className="api-profile-form-section">
                <h4>LLM 大模型 API</h4>
                <div className="api-profile-grid">
                  <div className="settings-field">
                    <label>提供商</label>
                    <select className="input-field" value={profileForm.llm.provider} onChange={(e) => handleProviderChange(e.target.value)}>
                      {LLM_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                    </select>
                  </div>
                  <div className="settings-field">
                    <label>模型 *</label>
                    <input className="input-field" value={profileForm.llm.model} onChange={(e) => updateProfileNested('llm', 'model', e.target.value)} placeholder="deepseek-chat" />
                  </div>
                </div>
                <div className="settings-field">
                  <label>API 地址 *</label>
                  <input className="input-field" value={profileForm.llm.api_url} onChange={(e) => updateProfileNested('llm', 'api_url', e.target.value)} placeholder="https://api.deepseek.com" />
                </div>
                <div className="settings-field">
                  <label>API Key</label>
                  <div className="settings-input-row">
                    <input
                      className="input-field settings-input"
                      type={visibleProfileKeys.llm ? 'text' : 'password'}
                      value={profileForm.llm.api_key}
                      onChange={(e) => updateProfileNested('llm', 'api_key', e.target.value)}
                      placeholder={profileForm.llm.provider === 'ollama' ? '本地模型可留空' : 'sk-...'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="settings-icon-btn" onClick={() => toggleProfileKey('llm')}>{visibleProfileKeys.llm ? '隐' : '显'}</button>
                  </div>
                </div>
              </div>

              <div className="api-profile-form-section">
                <h4>GRSai 生图 API</h4>
                <div className="settings-field">
                  <label>API 地址 *</label>
                  <input className="input-field" value={profileForm.grsai.api_host} onChange={(e) => updateProfileNested('grsai', 'api_host', e.target.value)} placeholder="https://grsai.dakka.com.cn" />
                </div>
                <div className="settings-field">
                  <label>API Key</label>
                  <div className="settings-input-row">
                    <input
                      className="input-field settings-input"
                      type={visibleProfileKeys.grsai ? 'text' : 'password'}
                      value={profileForm.grsai.api_key}
                      onChange={(e) => updateProfileNested('grsai', 'api_key', e.target.value)}
                      placeholder="grsai key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="settings-icon-btn" onClick={() => toggleProfileKey('grsai')}>{visibleProfileKeys.grsai ? '隐' : '显'}</button>
                  </div>
                </div>
              </div>

              <label className="api-profile-check">
                <input type="checkbox" checked={!!profileForm.is_active} onChange={(e) => updateProfileField('is_active', e.target.checked)} />
                保存后立即设为当前生效配置
              </label>

              {profileMsg && <p className="error-text">{profileMsg}</p>}

              <div className="api-profile-modal-actions">
                <button type="button" className="btn-outline" onClick={() => setShowProfileForm(false)}>取消</button>
                <button type="button" className="generate-btn" disabled={profileBusy === 'save'} onClick={saveProfile}>
                  {profileBusy === 'save' ? '保存中...' : '保存配置档'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsPanel
