import { useState, useEffect } from 'react';

const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', urlPlaceholder: 'https://api.deepseek.com' },
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', urlPlaceholder: 'https://api.openai.com/v1' },
  { id: 'ollama', name: 'Ollama (本地)', defaultModel: 'llama3', urlPlaceholder: 'http://localhost:11434' },
];

export default function LLMConfigPanel({ onBack }) {
  const [configs, setConfigs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [form, setForm] = useState({
    name: '',
    provider: 'deepseek',
    api_url: '',
    api_key: '',
    model: '',
    is_default: false,
  });

  useEffect(() => {
    fetchConfigs();
  }, []);

  async function fetchConfigs() {
    try {
      const resp = await fetch('/api/llm-config');
      const data = await resp.json();
      if (data.success) {
        setConfigs(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch configs:', err);
    }
  }

  function resetForm(providerId) {
    const provider = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
    setForm({
      name: '',
      provider: provider.id,
      api_url: provider.urlPlaceholder,
      api_key: '',
      model: provider.defaultModel,
      is_default: configs.length === 0,
    });
    setEditingId(null);
  }

  function handleProviderChange(providerId) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (provider) {
      setForm(f => ({
        ...f,
        provider: provider.id,
        api_url: provider.urlPlaceholder,
        model: provider.defaultModel,
      }));
    }
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.api_url.trim() || !form.model.trim()) {
      alert('请填写名称、API地址和模型');
      return;
    }

    try {
      const url = editingId ? `/api/llm-config/${editingId}` : '/api/llm-config';
      const method = editingId ? 'PUT' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await resp.json();
      if (data.success) {
        fetchConfigs();
        setShowForm(false);
        resetForm(form.provider);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  }

  async function handleEdit(config) {
    setForm({
      name: config.name,
      provider: config.provider,
      api_url: config.api_url,
      api_key: config.api_key || '',
      model: config.model,
      is_default: config.is_default === 1,
    });
    setEditingId(config.id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    if (!confirm('确定删除这个配置？')) return;
    try {
      await fetch(`/api/llm-config/${id}`, { method: 'DELETE' });
      fetchConfigs();
    } catch (err) {
      alert('删除失败');
    }
  }

  async function handleSetDefault(id) {
    const config = configs.find(c => c.id === id);
    if (!config) return;
    try {
      const resp = await fetch(`/api/llm-config/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, is_default: true, api_key: config.api_key || '' }),
      });
      const data = await resp.json();
      if (data.success) {
        fetchConfigs();
      } else {
        alert(data.message || '设置失败');
      }
    } catch (err) {
      alert('设置失败: ' + err.message);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);

    try {
      const resp = await fetch('/api/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          api_url: form.api_url,
          api_key: form.api_key,
          model: form.model,
        }),
      });

      const data = await resp.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-outline" onClick={onBack}>← 返回</button>
          <span style={{ fontWeight: 600, fontSize: 16 }}>LLM 配置管理</span>
        </div>
        <button className="generate-btn" onClick={() => { resetForm(form.provider); setShowForm(true); }}>
          + 添加配置
        </button>
      </div>

      {/* 配置列表 */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {configs.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 60,
            color: 'var(--text-secondary)',
          }}>
            暂无配置，点击上方按钮添加
          </div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          {configs.map(config => (
            <div
              key={config.id}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 12,
                padding: 20,
                border: config.is_default ? '2px solid #10b981' : '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{config.name}</span>
                    {config.is_default === 1 && (
                      <span style={{
                        background: '#10b981',
                        color: '#fff',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                      }}>默认</span>
                    )}
                    <span style={{
                      background: 'var(--bg-tertiary)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                    }}>
                      {PROVIDERS.find(p => p.id === config.provider)?.name || config.provider}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <div>模型: {config.model}</div>
                    <div style={{ marginTop: 4, wordBreak: 'break-all' }}>
                      API: {config.api_url}
                    </div>
                    {config.api_key && (
                      <div style={{ marginTop: 4 }}>
                        Key: ••••••••{config.api_key.slice(-4)}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {config.is_default !== 1 && (
                    <button
                      className="btn-outline"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => handleSetDefault(config.id)}
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    className="btn-outline"
                    style={{ fontSize: 12, padding: '4px 12px' }}
                    onClick={() => handleEdit(config)}
                  >
                    编辑
                  </button>
                  <button
                    className="btn-outline"
                    style={{ fontSize: 12, padding: '4px 12px', color: '#ef4444' }}
                    onClick={() => handleDelete(config.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 添加/编辑表单弹窗 */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-content" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600 }}>{editingId ? '编辑配置' : '添加 LLM 配置'}</span>
              <button className="btn-back" onClick={() => setShowForm(false)} style={{ border: 'none', background: 'transparent', fontSize: 18 }}>×</button>
            </div>

            <div style={{ padding: 20 }}>
              <div className="section-label">配置名称 *</div>
              <input
                className="input-field"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="例如：DeepSeek 生产环境"
              />

              <div className="section-label" style={{ marginTop: 16 }}>提供商 *</div>
              <select
                className="input-field"
                value={form.provider}
                onChange={e => handleProviderChange(e.target.value)}
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <div className="section-label" style={{ marginTop: 16 }}>API 地址 *</div>
              <input
                className="input-field"
                value={form.api_url}
                onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))}
                placeholder={PROVIDERS.find(p => p.id === form.provider)?.urlPlaceholder}
              />

              <div className="section-label" style={{ marginTop: 16 }}>API Key</div>
              <input
                className="input-field"
                type="password"
                value={form.api_key}
                onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder={form.provider === 'ollama' ? '本地部署无需填写' : 'sk-...'}
              />
              {form.provider === 'deepseek' && !form.api_key && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  提示：也可在侧边栏「设置」→「LLM 文案」中统一配置 DeepSeek API Key，此处无需重复填写
                </div>
              )}

              <div className="section-label" style={{ marginTop: 16 }}>模型 *</div>
              <input
                className="input-field"
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder={PROVIDERS.find(p => p.id === form.provider)?.defaultModel}
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                />
                <span style={{ fontSize: 14 }}>设为默认配置</span>
              </label>

              {/* 测试连接 */}
              <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>测试连接</span>
                  <button
                    className="btn-outline"
                    style={{ fontSize: 12 }}
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? '测试中...' : '测试'}
                  </button>
                </div>
                {testResult && (
                  <div style={{
                    marginTop: 12,
                    fontSize: 13,
                    color: testResult.success ? '#10b981' : '#ef4444',
                  }}>
                    {testResult.success ? '✓ ' + (testResult.data?.response || '连接成功') : '✗ ' + testResult.message}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn-outline" style={{ flex: 1 }} onClick={() => setShowForm(false)}>取消</button>
                <button className="generate-btn" style={{ flex: 1 }} onClick={handleSubmit}>
                  {editingId ? '保存修改' : '添加配置'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
