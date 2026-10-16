import { useState, useEffect } from 'react';
import { Icon } from './components/Icons';

export default function StyleProfileManager({ onBack, onSelectProfile }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editRules, setEditRules] = useState('');
  const [editNegative, setEditNegative] = useState('');
  const [editModel, setEditModel] = useState('gpt-image-2.5');
  const [editDefault, setEditDefault] = useState(false);
  const [models, setModels] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfiles();
    fetch('/api/ai-dialog/options').then(response => response.json()).then(result => { if (result.success) setModels(result.data.models); }).catch(() => {});
  }, []);

  async function fetchProfiles() {
    try {
      const resp = await fetch('/api/style-profiles');
      const data = await resp.json();
      if (data.success) setProfiles(data.data);
    } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除该风格画像？')) return;
    await fetch(`/api/style-profiles/${id}`, { method: 'DELETE' });
    setProfiles(prev => prev.filter(p => p.id !== id));
    if (selectedProfile?.id === id) setSelectedProfile(null);
  }

  async function handleSaveEdit() {
    if (!selectedProfile || saving) return;
    if (!editName.trim()) { setError('请输入风格名称'); return; }
    setSaving(true); setError('');
    try {
    const resp = await fetch(selectedProfile.id ? `/api/style-profiles/${selectedProfile.id}` : '/api/style-profiles', {
      method: selectedProfile.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName,
        description: editDesc,
        tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
        promptTemplate: editPrompt,
        parameters: { ...selectedProfile.parameters, model: editModel, brandRules: editRules, negativePrompt: editNegative, dialogDefault: editDefault },
      }),
    });
    const data = await resp.json();
    if (data.success) {
      setProfiles(prev => prev.map(p => p.id === selectedProfile.id ? data.data : p));
      setSelectedProfile(data.data);
      setEditMode(false);
      await fetchProfiles();
    }
    else throw new Error(data.message || '保存失败');
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }

  function openEdit(profile) {
    setSelectedProfile(profile);
    setEditName(profile.name);
    setEditDesc(profile.description || '');
    setEditTags((profile.tags || []).join(', '));
    setEditPrompt(profile.promptTemplate || '');
    setEditRules(profile.parameters?.brandRules || '');
    setEditNegative(profile.parameters?.negativePrompt || '');
    setEditModel(profile.parameters?.model || 'gpt-image-2.5');
    setEditDefault(profile.parameters?.dialogDefault === true);
    setError('');
    setEditMode(true);
  }

  const filtered = profiles.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.tags || []).some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (editMode && selectedProfile) {
    return (
      <div className="surface-page surface-style-manager surface-editor" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 20, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button className="btn-outline" onClick={() => setEditMode(false)}>← 返回</button>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{selectedProfile.id ? '编辑风格画像' : '新建品牌风格'}</span>
        </div>
        <div className="section-label">名称</div>
        <input className="input-field" value={editName} onChange={e => setEditName(e.target.value)} />
        <div className="section-label" style={{ marginTop: 12 }}>描述</div>
        <textarea className="input-field" style={{ minHeight: 60 }} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
        <div className="section-label" style={{ marginTop: 12 }}>标签（逗号分隔）</div>
        <input className="input-field" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="海报, 电商, 春季" />
        <div className="section-label" style={{ marginTop: 12 }}>Prompt 模板</div>
        <textarea className="input-field" style={{ minHeight: 120 }} value={editPrompt} onChange={e => setEditPrompt(e.target.value)} />
        <label className="section-label" htmlFor="style-brand-rules" style={{ marginTop: 12 }}>品牌硬约束</label>
        <textarea id="style-brand-rules" className="input-field" style={{ minHeight: 100 }} value={editRules} onChange={e => setEditRules(e.target.value)} maxLength={4000} />
        <label className="section-label" htmlFor="style-negative" style={{ marginTop: 12 }}>禁止事项</label>
        <textarea id="style-negative" className="input-field" style={{ minHeight: 60 }} value={editNegative} onChange={e => setEditNegative(e.target.value)} maxLength={2000} />
        <label className="section-label" htmlFor="style-image-model" style={{ marginTop: 12 }}>默认生图模型</label>
        <select id="style-image-model" className="input-field" value={editModel} onChange={event => setEditModel(event.target.value)}>{models.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13 }}><input type="checkbox" checked={editDefault} onChange={event => setEditDefault(event.target.checked)} />智能对话默认品牌风格</label>
        {error && <p role="alert" style={{ color: '#dc5c64', fontSize: 13 }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <button className="generate-btn" disabled={saving} onClick={handleSaveEdit}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-page surface-style-manager" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="surface-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && <button className="btn-outline" onClick={onBack}>← 返回</button>}
          <span style={{ fontWeight: 600, fontSize: 16 }}>风格画像管理</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>({filtered.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input className="input-field" style={{ width: 180 }} placeholder="搜索风格..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /><button className="btn-outline" onClick={() => openEdit({ name: '', parameters: {} })}><Icon.Plus size={14} />新建风格</button></div>
      </div>

      <div className="surface-content" style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
            {searchQuery ? '没有匹配的风格画像' : '暂无风格画像，在自由创作中生成满意图片后可保存为风格'}
          </div>
        ) : (
          <div className="surface-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filtered.map(profile => (
              <div className="surface-card" key={profile.id} style={{
                background: 'var(--bg-secondary)', borderRadius: 8, padding: 16,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.name}{profile.parameters?.dialogDefault && <small style={{ marginLeft: 8, color: 'var(--primary-color)' }}>默认</small>}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-outline" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => openEdit(profile)}><Icon.Edit size={12} /></button>
                    <button className="btn-outline" style={{ padding: '2px 8px', fontSize: 11, color: '#ef4444' }} onClick={() => handleDelete(profile.id)}><Icon.Trash size={12} /></button>
                  </div>
                </div>
                {profile.description && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{profile.description}</p>
                )}
                {profile.referenceImageUrl && (
                  <img src={profile.referenceImageUrl} alt={profile.name}
                    style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                )}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {(profile.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'var(--bg-tertiary)', padding: '1px 8px', borderRadius: 4, fontSize: 11 }}>{tag}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span><Icon.Target size={11} /> {profile.usageCount || 0} 次使用</span>
                  <span><Icon.Star size={11} /> {profile.rating || 0} 分</span>
                  <span><Icon.Maximize size={11} /> {profile.parameters?.aspectRatio || '-'}</span>
                </div>
                {profile.promptTemplate && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: 8, borderRadius: 6, maxHeight: 60, overflow: 'hidden' }}>
                    {profile.promptTemplate.slice(0, 120)}{profile.promptTemplate.length > 120 ? '...' : ''}
                  </div>
                )}
                {onSelectProfile && (
                  <button className="btn-outline" style={{ marginTop: 8, width: '100%', fontSize: 12 }}
                    onClick={() => onSelectProfile(profile)}>
                    <Icon.Palette size={13} /> 使用此风格生成
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
