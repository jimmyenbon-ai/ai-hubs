import { useState } from 'react'
import RoleSelector from './RoleSelector'

const CONTENT_TYPES = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'music', label: '音乐' },
]

function Sidebar({ currentGroup, currentMode, currentRole, onRoleChange, templates = [], onNavigate, onCreateTemplate, onManageTemplates, showEnterpriseEntry = false, onOpenEnterprise, onOpenPromptLibrary, onOpenWorkflow, onOpenStoryboard, onOpenProductAutomation, onOpenPreviz, onOpenStyleManager, onOpenSettings, onOpenTutorial, onOpenAIDialog }) {
  const [expandedGroups, setExpandedGroups] = useState({
    image: true,
    video: false,
    music: false,
  })

  function toggleGroup(groupId) {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }))
  }

  // 按 group 分组模板
  const templatesByGroup = {}
  templates.forEach((t) => {
    if (!templatesByGroup[t.group]) templatesByGroup[t.group] = []
    templatesByGroup[t.group].push(t)
  })

  const groups = [
    {
      id: 'image',
      label: 'AI 图片生成',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21,15 16,10 5,21"/>
        </svg>
      ),
    },
    {
      id: 'video',
      label: 'AI 视频生成',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23,7 16,12 23,17"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      ),
    },
    {
      id: 'music',
      label: 'Suno AI音乐生成',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      ),
    },
  ]

  return (
    <aside className="sidebar workbench-sidebar">
      <div className="logo-name">Enbon AI</div>
      <div className="logo-subtitle">设计工作台</div>
      <RoleSelector currentRole={currentRole} onRoleChange={onRoleChange} />
      {showEnterpriseEntry && (
        <div className="nav-library-entry enterprise-nav-entry" style={{ padding: '8px 10px 2px' }}>
          <button
            type="button"
            className={`nav-group-header enterprise-nav-button ${currentGroup === 'enterprise' ? 'active-group' : ''}`}
            onClick={onOpenEnterprise}
          >
            <span className="nav-group-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/>
              </svg>
            </span>
            <span className="nav-group-label">企业 AI 工作台</span>
            <span className="enterprise-nav-badge">V1</span>
          </button>
        </div>
      )}
      <nav className="nav-menu">
        {groups.map((group) => {
          const groupTemplates = templatesByGroup[group.id] || []
          const isExpanded = expandedGroups[group.id]
          const isActiveGroup = currentGroup === group.id

          return (
            <div key={group.id} className="nav-group">
              {/* 分组标题行 */}
              <div
                className={`nav-group-header ${isExpanded ? 'expanded' : ''} ${isActiveGroup ? 'active-group' : ''}`}
                onClick={() => toggleGroup(group.id)}
              >
                <span className="nav-group-icon">{group.icon}</span>
                <span className="nav-group-label">{group.label}</span>
                <span className={`nav-group-arrow ${isExpanded ? 'rotated' : ''}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6,9 12,15 18,9"/>
                  </svg>
                </span>
              </div>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="nav-group-items">
                  {/* 自由创作入口 */}
                  <div
                    className={`nav-item ${isActiveGroup && currentMode === 'free' ? 'active' : ''}`}
                    onClick={() => onNavigate(group.id, 'free')}
                  >
                    <span className="nav-item-dot" />
                    自由创作
                  </div>

                  {/* 批量生成入口（仅图片组） */}
                  {group.id === 'image' && (
                    <div
                      className={`nav-item ${isActiveGroup && currentMode === 'batch' ? 'active' : ''}`}
                      onClick={() => onNavigate(group.id, 'batch')}
                    >
                      <span className="nav-item-dot" />
                      批量生成
                    </div>
                  )}

                  {/* 模板列表（仅图片组展示） */}
                  {group.id === 'image' && (
                    <>
                      <div className="nav-divider" />
                      <div className="nav-section-label-row">
                        <span className="nav-section-label">一键制作</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="nav-add-template-btn"
                            onClick={(e) => { e.stopPropagation(); if (typeof onCreateTemplate === 'function') onCreateTemplate() }}
                            title="新建模板"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="12" y1="5" x2="12" y2="19"/>
                              <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                          </button>
                          <button
                            className="nav-add-template-btn"
                            onClick={(e) => { e.stopPropagation(); if (typeof onManageTemplates === 'function') onManageTemplates() }}
                            title="模板管理"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <circle cx="12" cy="12" r="3"/>
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      {groupTemplates.length === 0 && (
                        <div className="nav-item nav-empty-hint">暂无模板</div>
                      )}
                      {groupTemplates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className={`nav-item nav-template-item ${isActiveGroup && currentMode === `tpl_${tpl.id}` ? 'active' : ''}`}
                          onClick={() => onNavigate(group.id, `tpl_${tpl.id}`)}
                          title={tpl.description}
                        >
                          <span className="nav-item-dot" />
                          {tpl.icon ? tpl.icon : ''}
                          <span>{tpl.name}</span>
                          {tpl.pointsCost && (
                            <span className="nav-template-points">{tpl.pointsCost}分</span>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      {/* AI 对话入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'ai-dialog' ? 'active-group' : ''}`}
          onClick={onOpenAIDialog}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span className="nav-group-label">AI 智能对话</span>
        </div>
      </div>

      {/* 工作流入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'workflow' ? 'active-group' : ''}`}
          onClick={onOpenWorkflow}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </span>
          <span className="nav-group-label">AI 工作流</span>
        </div>
      </div>

      {/* AI 视频自动化入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'storyboard' ? 'active-group' : ''}`}
          onClick={onOpenStoryboard}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
          </span>
          <span className="nav-group-label">AI 视频自动化</span>
        </div>
      </div>

      {/* 产品图自动化入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'product-automation' ? 'active-group' : ''}`}
          onClick={onOpenProductAutomation}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </span>
          <span className="nav-group-label">产品图自动化</span>
        </div>
      </div>

      {/* 3D 预演导演入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'previz' ? 'active-group' : ''}`}
          onClick={onOpenPreviz}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
              <line x1="12" y1="22" x2="12" y2="15.5"/>
              <polyline points="22 8.5 12 15.5 2 8.5"/>
            </svg>
          </span>
          <span className="nav-group-label">3D 预演导演</span>
        </div>
      </div>

      {/* 提示词模板库入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'library' ? 'active-group' : ''}`}
          onClick={onOpenPromptLibrary}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </span>
          <span className="nav-group-label">模板库</span>
        </div>
      </div>

      {/* 风格管理入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'styles' ? 'active-group' : ''}`}
          onClick={onOpenStyleManager}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', opacity: 0.7 }}
          title="风格画像管理"
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
            </svg>
          </span>
          <span className="nav-group-label">风格管理</span>
        </div>
      </div>

      {/* 教程入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className="nav-group-header"
          onClick={onOpenTutorial}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', opacity: 0.7 }}
          title="AI 使用教程"
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </span>
          <span className="nav-group-label">教程</span>
        </div>
      </div>

      {/* 系统设置入口 */}
      <div className="nav-library-entry" style={{ padding: '8px 10px' }}>
        <div
          className={`nav-group-header ${currentGroup === 'settings' ? 'active-group' : ''}`}
          onClick={onOpenSettings}
          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', opacity: 0.7 }}
          title="系统设置"
        >
          <span className="nav-group-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </span>
          <span className="nav-group-label">设置</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
