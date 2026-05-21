import { useState } from 'react'

function TemplateManage({ templates, onBack, onEdit, onDelete, onRefresh }) {
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const filtered = templates.filter(
    (t) =>
      !search ||
      (t.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.category || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(search.toLowerCase()),
  )

  async function handleDelete(tpl) {
    if (!confirm(`确定要删除模板「${tpl.name}」吗？此操作不可恢复。`)) return
    setDeletingId(tpl.id)
    try {
      await onDelete(tpl.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="template-manage-panel">
      <div className="template-manage-header">
        <h2 className="template-manage-title">模板管理</h2>
        <button
          className="btn-back"
          onClick={onBack}
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <input
        className="template-manage-search"
        placeholder="搜索模板名称、分类、描述..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          共 {filtered.length} 个模板
        </span>
        <button className="btn-outline small" onClick={onRefresh}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          {' '}刷新
        </button>
      </div>

      <div className="template-manage-list">
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
            {search ? '没有找到匹配的模板' : '暂无模板，点击左侧「+」新建'}
          </div>
        )}
        {filtered.map((tpl) => (
          <div key={tpl.id} className="template-manage-item">
            <div className="template-manage-item-icon">{tpl.icon || '📄'}</div>
            <div className="template-manage-item-info">
              <div className="template-manage-item-name">{tpl.name}</div>
              <div className="template-manage-item-meta">
                {tpl.category && <span>{tpl.category}</span>}
                {tpl.pointsCost && <span>{tpl.pointsCost}积分</span>}
                <span>{tpl.group || 'image'}</span>
              </div>
              {tpl.description && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tpl.description}
                </div>
              )}
            </div>
            <div className="template-manage-item-actions">
              <button className="btn-outline small" onClick={() => onEdit(tpl.id)} title="编辑">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button
                className="btn-outline small"
                onClick={() => handleDelete(tpl)}
                disabled={deletingId === tpl.id}
                title="删除"
              >
                {deletingId === tpl.id ? '...' : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default TemplateManage
