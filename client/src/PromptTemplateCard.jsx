export default function PromptTemplateCard({ template, onUse, onEdit, onDelete }) {
  const hasCover = template.coverImage && template.coverImage.trim()
  const tags = Array.isArray(template.tags) ? template.tags : []
  const name = template.name || '未命名模板'
  const prompt = template.prompt || ''
  const promptPreview = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt

  function handleUse(e) {
    e.stopPropagation()
    onUse(template)
  }

  function handleEdit(e) {
    e.stopPropagation()
    onEdit(template)
  }

  function handleDelete(e) {
    e.stopPropagation()
    onDelete(template)
  }

  return (
    <div className="prompt-template-card">
      {/* 封面图 */}
      <div className="prompt-template-card-thumb">
        {hasCover ? (
          <img src={template.coverImage} alt={name} loading="lazy" />
        ) : (
          <div className="prompt-template-card-thumb-placeholder">
            <div className="prompt-template-card-thumb-placeholder-icon">🖼️</div>
            <span>暂无封面</span>
          </div>
        )}
        <div className="prompt-template-card-thumb-overlay">
          <button
            className="prompt-template-card-use-btn"
            onClick={handleUse}
          >
            使用此模板
          </button>
        </div>
      </div>

      {/* 卡片内容 */}
      <div className="prompt-template-card-body">
        <div className="prompt-template-card-name">{name}</div>
        {promptPreview && (
          <div className="prompt-template-card-prompt">{promptPreview}</div>
        )}

        <div className="prompt-template-card-footer">
          <div className="prompt-template-card-meta">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className="prompt-template-card-tag">{tag}</span>
            ))}
            {template.model && (
              <span className="prompt-template-card-model">{template.model}</span>
            )}
          </div>
          <div className="prompt-template-card-actions">
            <button
              className="prompt-template-card-action-btn"
              onClick={handleEdit}
              title="编辑模板"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              className="prompt-template-card-action-btn delete"
              onClick={handleDelete}
              title="删除模板"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
