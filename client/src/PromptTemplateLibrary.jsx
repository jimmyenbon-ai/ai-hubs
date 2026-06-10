import { useState, useEffect } from 'react'
import PromptTemplateCard from './PromptTemplateCard'
import PromptTemplateModal from './PromptTemplateModal'
import { Icon } from './components/Icons'

const TYPE_TABS = [
  { value: 'image', label: '图片', Icon: Icon.Image },
  { value: 'video', label: '视频', Icon: Icon.Video },
  { value: 'music', label: '音乐', Icon: Icon.Music },
]

export default function PromptTemplateLibrary({ onUseTemplate, currentGroup, currentMode, onNavigate }) {
  const [activeType, setActiveType] = useState('image')
  const [showRecommended, setShowRecommended] = useState(false)
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [suggestions, setSuggestions] = useState([])

  // 弹窗状态
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null) // null = 新建
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  async function fetchTemplates() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ contentType: activeType })
      if (search) params.set('search', search)
      if (selectedCategory) params.set('category', selectedCategory)
      const resp = await fetch(`/api/prompt-templates?${params}`)
      const data = await resp.json()
      if (data.success) setTemplates(data.data || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  async function fetchCategories() {
    try {
      const resp = await fetch(`/api/prompt-templates/categories?contentType=${activeType}`)
      const data = await resp.json()
      if (data.success) setCategories(data.data || [])
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (showRecommended) {
      fetchSuggestions()
    } else {
      fetchTemplates()
      fetchCategories()
    }
  }, [activeType, showRecommended])

  async function fetchSuggestions() {
    setLoading(true)
    try {
      const resp = await fetch('/api/feedback/suggestions')
      const data = await resp.json()
      if (data.success) setSuggestions(data.data || [])
    } catch (_) {}
    setLoading(false)
  }

  async function handleConvertSuggestion(pattern) {
    try {
      const resp = await fetch(`/api/feedback/suggestions/${encodeURIComponent(pattern)}/convert`, { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        alert('已转为提示词模板！')
        fetchSuggestions()
      }
    } catch (_) {}
  }

  // 防抖搜索
  useEffect(() => {
    const t = setTimeout(fetchTemplates, 300)
    return () => clearTimeout(t)
  }, [search, selectedCategory])

  function handleTypeChange(type) {
    setActiveType(type)
    setSearch('')
    setSelectedCategory('')
  }

  function handleUse(template) {
    if (onUseTemplate) onUseTemplate(template)
  }

  function handleCardClick(template) {
    // 如果当前不在对应的分组，点击卡片则导航到该分组
    if (onNavigate && template.contentType && currentGroup !== template.contentType) {
      onNavigate(template.contentType, `tpl_${template.id}`)
    }
  }

  function handleEdit(template) {
    setEditTarget(template)
    setShowModal(true)
  }

  function handleDelete(template) {
    setDeleteTarget(template)
    setShowDeleteConfirm(true)
  }

  async function handleSave(form, id) {
    const method = id ? 'PUT' : 'POST'
    const url = id ? `/api/prompt-templates/${id}` : '/api/prompt-templates'
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '保存失败')
    setShowModal(false)
    setEditTarget(null)
    fetchTemplates()
    fetchCategories()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const resp = await fetch(`/api/prompt-templates/${deleteTarget.id}`, { method: 'DELETE' })
    const data = await resp.json()
    if (!data.success) { setShowDeleteConfirm(false); return }
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
    fetchTemplates()
    fetchCategories()
  }

  return (
    <div className="prompt-library-panel">
      {/* 顶部工具栏 */}
      <div className="prompt-library-header">
        <div className="prompt-library-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 返回按钮 - 关闭模板库，返回到对应分组 */}
          <button
            onClick={() => onNavigate && onNavigate(currentGroup === 'library' ? 'image' : currentGroup, 'free')}
            style={{
              background: 'var(--btn-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              color: 'var(--text-main)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            返回
          </button>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          提示词模板库
        </div>

        <div className="prompt-library-toolbar">
          {/* 内容类型切换 */}
          <div className="prompt-library-type-tabs">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                className={`prompt-library-type-tab ${!showRecommended && activeType === tab.value ? 'active' : ''}`}
                onClick={() => { setShowRecommended(false); handleTypeChange(tab.value); }}
              >
                <tab.Icon size={14} /> {tab.label}
              </button>
            ))}
            <button
              className={`prompt-library-type-tab ${showRecommended ? 'active' : ''}`}
              onClick={() => setShowRecommended(true)}
              style={showRecommended ? { background: '#10b981', color: '#fff' } : {}}
            >
              <Icon.Star size={14} /> 推荐
            </button>
          </div>
        </div>

        <div className="prompt-library-toolbar" style={{ marginTop: 10 }}>
          {/* 搜索框 */}
          <input
            className="prompt-library-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模板名称或提示词…"
          />

          {/* 分类筛选 */}
          <select
            className="prompt-library-category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* 新建按钮 */}
          <button
            className="prompt-library-new-btn"
            onClick={() => { setEditTarget(null); setShowModal(true) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新建模板
          </button>
        </div>
      </div>

      {/* 模板卡片网格 */}
      <div className="prompt-library-body">
        {showRecommended ? (
          loading ? (
            <div className="prompt-library-empty"><div className="spinner" style={{ margin: '0 auto 12px' }} /><p>加载中…</p></div>
          ) : suggestions.length === 0 ? (
            <div className="prompt-library-empty">
              <div className="prompt-library-empty-icon"><Icon.Inbox size={36} /></div>
              <p>暂无推荐</p>
              <p style={{ fontSize: 12, opacity: 0.6 }}>对生成结果点赞后，高频好评的 Prompt 模式会出现在这里</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {suggestions.map((s, i) => (
                <div key={i} style={{
                  background: 'var(--bg-secondary)', borderRadius: 12, padding: 16,
                  border: '1px solid var(--border-color)', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.suggestedName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}><Icon.ThumbsUp size={12} /> {s.likeCount} 次好评 · 关键词: {s.pattern}</div>
                  </div>
                  <button className="generate-btn" style={{ fontSize: 12, padding: '6px 14px' }}
                    onClick={() => handleConvertSuggestion(s.pattern)}>
                    转为模板
                  </button>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="prompt-library-empty">
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <p>加载中…</p>
          </div>
        ) : templates.length === 0 && !search && !selectedCategory ? (
          <div className="prompt-library-empty">
            <div className="prompt-library-empty-icon"><Icon.Inbox size={36} /></div>
            <p>还没有模板</p>
            <p style={{ fontSize: 12, opacity: 0.6 }}>点击右上角「新建模板」创建第一个提示词模板</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="prompt-library-empty">
            <div className="prompt-library-empty-icon"><Icon.Search size={36} /></div>
            <p>没有找到匹配的模板</p>
            <p style={{ fontSize: 12, opacity: 0.6 }}>试试其他关键词或分类</p>
          </div>
        ) : (
          <div className="prompt-template-grid">
            {templates.map((tpl) => (
              <PromptTemplateCard
                key={tpl.id}
                template={tpl}
                onUse={handleUse}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建 / 编辑弹窗（渲染在组件内部，不阻塞侧边栏导航） */}
      {showModal && (
        <div
          className="prompt-library-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowModal(false); setEditTarget(null) } }}
        >
          <div className="prompt-library-modal-container">
            <PromptTemplateModal
              template={editTarget}
              onClose={() => { setShowModal(false); setEditTarget(null) }}
              onSave={handleSave}
              noBackdrop
            />
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {showDeleteConfirm && deleteTarget && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteConfirm(false); setDeleteTarget(null) } }}>
          <div className="modal-content confirm-modal">
            <div className="modal-header">
              <span style={{ fontWeight: 600, fontSize: 15 }}>确认删除</span>
            </div>
            <p className="modal-body-text">
              确定要删除模板「{deleteTarget.name}」吗？<br />
              此操作不可恢复。
            </p>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null) }}>取消</button>
              <button className="btn-outline btn-danger" onClick={confirmDelete}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
