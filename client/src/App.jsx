import { useCallback, useEffect, useState } from 'react'
import './App.css'
import Sidebar from './Sidebar'
import ImageFreePanel from './ImageFreePanel'
import TemplatePanel from './TemplatePanel'
import MusicGenerate from './MusicGenerate'
import VideoGenerate from './VideoGenerate'
import TemplateManage from './TemplateManage'
import PromptTemplateLibrary from './PromptTemplateLibrary'
import WorkflowPanel from './WorkflowPanel'
import BatchGeneratePanel from './BatchGeneratePanel'
import SettingsPanel from './SettingsPanel'
import StyleProfileManager from './StyleProfileManager'
import AIDialogPanel from './AIDialogPanel'
import StoryboardPanel from './StoryboardPanel'
import ProductAutomationPanel from './ProductAutomationPanel'
import DirectorPreviz from './DirectorPreviz'
import { Icon, ICON_LIST } from './components/Icons'

function App() {
  const [currentGroup, setCurrentGroup] = useState('image')
  const [currentMode, setCurrentMode] = useState('free')
  const [currentRole, setCurrentRole] = useState(() => localStorage.getItem('aihub_current_role') || 'role-general')
  const [templates, setTemplates] = useState([])
  const [points, setPoints] = useState(null) // null = not yet loaded
  const [pointsError, setPointsError] = useState(false)
  const [loadingPoints, setLoadingPoints] = useState(false)
  const [, setLoadingTemplates] = useState(false)
  const [showTemplateCreate, setShowTemplateCreate] = useState(false)
  const [showTemplateManage, setShowTemplateManage] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  // 从提示词模板库选中的模板，用于注入到创作区
  const [injectedTemplate, setInjectedTemplate] = useState(null)
  const [showWorkflow, setShowWorkflow] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showStyleManager, setShowStyleManager] = useState(false)
  const [showAIDialog, setShowAIDialog] = useState(false)
  const [showStoryboard, setShowStoryboard] = useState(false)
  const [showProductAutomation, setShowProductAutomation] = useState(false)
  const [showPreviz, setShowPreviz] = useState(false)
  const [userId, setUserId] = useState(() => localStorage.getItem('aihub_user_id') || null)

  // 切换主题
  function handleThemeChange(newTheme) {
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    // eslint-disable-next-line react-hooks/immutability
    document.documentElement.dataset.theme = newTheme
  }

  // 关闭移动端侧边栏
  function handleSidebarClose() {
    setSidebarOpen(false)
  }

  // 获取积分
  async function fetchPoints() {
    setLoadingPoints(true)
    setPointsError(false)
    try {
      const resp = await fetch('/api/points/balance')
      const data = await resp.json()
      if (data.success && typeof data.data === 'number') {
        setPoints(data.data)
        setPointsError(false)
      } else {
        setPointsError(true)
      }
    } catch {
      setPointsError(true)
    }
    setLoadingPoints(false)
  }

  const initUserId = useCallback(async () => {
    if (userId) return
    try {
      const resp = await fetch('/api/prefs/init')
      const data = await resp.json()
      if (data.success) {
        const newUserId = data.data.userId
        setUserId(newUserId)
        localStorage.setItem('aihub_user_id', newUserId)
      }
    } catch {
      // 初始化失败不阻塞页面使用
    }
  }, [userId])

  // 获取模板列表
  async function fetchTemplates() {
    setLoadingTemplates(true)
    try {
      const resp = await fetch('/api/templates?group=image')
      const data = await resp.json()
      if (data.success) {
        setTemplates(data.data || [])
      }
    } catch {
      // 模板加载失败时保留空列表
    }
    setLoadingTemplates(false)
  }

  useEffect(() => {
    // 初始化主题
    document.documentElement.dataset.theme = theme
    fetchPoints()
    fetchTemplates()
    initUserId()
    const interval = setInterval(fetchPoints, 30000)
    return () => clearInterval(interval)
  }, [initUserId, theme])

  function handleNavigate(group, mode) {
    setCurrentGroup(group)
    setCurrentMode(mode)
  }

  function handleRoleChange(roleId) {
    setCurrentRole(roleId)
    localStorage.setItem('aihub_current_role', roleId)
  }

  // 保存模板配置（编辑后调用）
  async function handleSaveTemplate(id, localTemplate) {
    const resp = await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localTemplate),
    })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '保存失败')
    setTemplates((prev) => prev.map((t) => t.id === Number(id) ? { ...t, ...localTemplate } : t))
    return data.data
  }

  // 新建模板
  async function handleCreateTemplate(fields) {
    const resp = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fields,
        group: 'image',
        model: 'gpt-image-2',
        aspectRatio: '16:9',
        imageSize: '1K',
        formFields: [],
        referenceImages: [],
        pointsCost: 1,
        promptTemplate: '',
      }),
    })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '创建失败')
    setTemplates((prev) => [data.data, ...prev])
    setShowTemplateCreate(false)
    handleNavigate('image', `tpl_${data.data.id}`)
  }

  // 删除模板
  async function handleDeleteTemplate(id) {
    const resp = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '删除失败')
    setTemplates((prev) => prev.filter((t) => t.id !== Number(id)))
    if (currentMode === `tpl_${id}`) {
      handleNavigate('image', 'free')
    }
  }

  // 从管理页编辑模板
  function handleEditTemplate(id) {
    setShowTemplateManage(false)
    handleNavigate('image', `tpl_${id}`)
  }

  function getCurrentTemplate() {
    if (!currentMode.startsWith('tpl_')) return null
    const id = Number(currentMode.replace('tpl_', ''))
    return templates.find((t) => t.id === id) || null
  }

  function renderImageWorkspace() {
    // 模板管理页
    if (showTemplateManage) {
      return (
        <TemplateManage
          templates={templates}
          onBack={() => setShowTemplateManage(false)}
          onEdit={handleEditTemplate}
          onDelete={handleDeleteTemplate}
          onRefresh={fetchTemplates}
        />
      )
    }
    if (currentMode === 'free') {
      return <ImageFreePanel injectedTemplate={injectedTemplate} onInjectedConsumed={() => setInjectedTemplate(null)} userId={userId} currentRole={currentRole} />
    }
    if (currentMode === 'batch') {
      return <BatchGeneratePanel />
    }
    const tpl = getCurrentTemplate()
    if (tpl) {
      return (
        <TemplatePanel
          key={tpl.id}
          template={tpl}
          templates={templates}
          onSave={handleSaveTemplate}
          onBack={() => handleNavigate('image', 'free')}
        />
      )
    }
    return <ImageFreePanel />
  }

  // 积分显示文案
  const pointsLabel = pointsError ? '--' : (loadingPoints ? '...' : (points !== null ? points : '--'))

  // 预设主题色选项
  const THEMES = [
    { id: 'dark', label: '深色', color: '#1a1a2e' },
    { id: 'gray', label: '灰色', color: '#1f2937' },
    { id: 'light', label: '浅色', color: '#ffffff' },
    { id: 'blue', label: '蓝色', color: '#112240' },
  ]

  return (
    <div className="app-shell">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={handleSidebarClose} />
      )}

      <div className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <Sidebar
          currentGroup={currentGroup}
          currentMode={currentMode}
          currentRole={currentRole}
          onRoleChange={handleRoleChange}
          templates={templates}
          onNavigate={(g, m) => { handleNavigate(g, m); setSidebarOpen(false) }}
          onCreateTemplate={() => setShowTemplateCreate(true)}
          onManageTemplates={() => { setShowTemplateManage(true); setSidebarOpen(false) }}
          onOpenPromptLibrary={() => {
            // 如果当前已在模板库，则关闭；否则打开
            if (showPromptLibrary) {
              setShowPromptLibrary(false)
            } else {
              setShowPromptLibrary(true)
            }
          }}
          onOpenWorkflow={() => {
            setCurrentGroup('workflow')
            setShowWorkflow(true)
            setShowAIDialog(false)
            setShowStoryboard(false)
            setShowProductAutomation(false)
            setSidebarOpen(false)
          }}
          onOpenAIDialog={() => {
            setCurrentGroup('ai-dialog')
            setShowAIDialog(true)
            setShowWorkflow(false)
            setShowPromptLibrary(false)
            setShowStoryboard(false)
            setShowProductAutomation(false)
            setSidebarOpen(false)
          }}
          onOpenStoryboard={() => {
            setCurrentGroup('storyboard')
            setShowStoryboard(true)
            setShowProductAutomation(false)
            setShowWorkflow(false)
            setShowAIDialog(false)
            setShowPromptLibrary(false)
            setShowSettings(false)
            setShowStyleManager(false)
            setShowPreviz(false)
            setSidebarOpen(false)
          }}
          onOpenProductAutomation={() => {
            setCurrentGroup('product-automation')
            setShowProductAutomation(true)
            setShowStoryboard(false)
            setShowWorkflow(false)
            setShowAIDialog(false)
            setShowPromptLibrary(false)
            setShowSettings(false)
            setShowStyleManager(false)
            setShowPreviz(false)
            setSidebarOpen(false)
          }}
          onOpenPreviz={() => {
            setCurrentGroup('previz')
            setShowPreviz(true)
            setShowStoryboard(false)
            setShowProductAutomation(false)
            setShowWorkflow(false)
            setShowAIDialog(false)
            setShowPromptLibrary(false)
            setShowSettings(false)
            setShowStyleManager(false)
            setSidebarOpen(false)
          }}
          onOpenStyleManager={() => {
            setShowStyleManager(true)
            setShowWorkflow(false)
            setShowSettings(false)
            setShowProductAutomation(false)
            setShowPromptLibrary(false)
            setSidebarOpen(false)
          }}
          onOpenSettings={() => {
            if (showSettings) {
              setShowSettings(false)
            } else {
              setShowSettings(true)
              setShowWorkflow(false)
              setShowProductAutomation(false)
              setShowPromptLibrary(false)
            }
            setSidebarOpen(false)
          }}
          onOpenTutorial={() => {
            window.open('/AI文档.html', '_blank')
            setSidebarOpen(false)
          }}
        />
      </div>

      <div className="main-wrapper">
        <header className="top-header">
          <div className="top-header-left">
            {/* 移动端菜单按钮 */}
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-main)',
                cursor: 'pointer',
                padding: '4px 8px 4px 0',
                display: 'none',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <span className="header-title">
              {showPreviz && '3D 预演导演'}
              {showProductAutomation && !showPreviz && '产品图自动化'}
              {showStoryboard && !showPreviz && 'AI 视频自动化'}
              {showWorkflow && !showStoryboard && !showProductAutomation && !showPreviz && 'AI 工作流'}
              {showPromptLibrary && !showStoryboard && !showProductAutomation && '提示词模板库'}
              {!showStoryboard && !showProductAutomation && !showWorkflow && !showPromptLibrary && currentGroup === 'image' && currentMode === 'free' && 'AI 图片生成 · 自由创作'}
              {!showStoryboard && !showProductAutomation && !showWorkflow && !showPromptLibrary && currentGroup === 'image' && currentMode === 'batch' && 'AI 图片生成 · 批量生成'}
              {showSettings && !showStoryboard && !showProductAutomation && '系统设置'}
              {showAIDialog && !showStoryboard && !showProductAutomation && 'AI 智能对话'}
              {!showStoryboard && !showProductAutomation && !showWorkflow && !showPromptLibrary && currentGroup === 'image' && currentMode.startsWith('tpl_') && (getCurrentTemplate()?.name || '模板生成')}
              {!showStoryboard && !showProductAutomation && !showWorkflow && !showPromptLibrary && currentGroup === 'video' && 'AI 视频生成'}
              {!showStoryboard && !showProductAutomation && !showWorkflow && !showPromptLibrary && currentGroup === 'music' && 'Suno AI音乐生成'}
            </span>
          </div>
          <div className="header-actions">
            {/* 主题切换 */}
            <div className="theme-switcher">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-btn ${theme === t.id ? 'active' : ''}`}
                  style={{ background: t.color }}
                  onClick={() => handleThemeChange(t.id)}
                  title={`切换到${t.label}模式`}
                />
              ))}
            </div>
            <button className="btn-outline" type="button" onClick={fetchPoints}>
              {pointsError ? '积分: --' : `积分: ${pointsLabel}`}
              {/* 积分预警：低于10分时显示警告 */}
              {!pointsError && points !== null && points < 10 && (
                <span style={{ marginLeft: 6, color: '#f97316', fontSize: 12 }} title="积分不足，请及时充值"><Icon.AlertTriangle size={12} /></span>
              )}
            </button>
          </div>
        </header>

        <div className="workspace">
          {showPromptLibrary && (
            <PromptTemplateLibrary
              onUseTemplate={(tpl) => {
                if (tpl.contentType === 'image') {
                  setInjectedTemplate(tpl)
                  setCurrentGroup('image')
                  setCurrentMode('free')
                  setShowPromptLibrary(false)
                } else {
                  alert(`${tpl.contentType === 'video' ? '视频' : '音乐'}模板功能开发中`)
                }
              }}
              currentGroup={currentGroup}
              currentMode={currentMode}
              onNavigate={(g, m) => {
                setShowPromptLibrary(false)
                setCurrentGroup(g)
                setCurrentMode(m)
              }}
            />
          )}
          {showPreviz && <DirectorPreviz onBack={() => setShowPreviz(false)} />}
          {showProductAutomation && !showPreviz && <ProductAutomationPanel onBack={() => setShowProductAutomation(false)} />}
          {showStoryboard && !showPreviz && <StoryboardPanel onBack={() => setShowStoryboard(false)} onNavigateToVideo={() => { setShowStoryboard(false); setCurrentGroup('video') }} />}
          {showAIDialog && !showStoryboard && !showProductAutomation && !showPreviz && <AIDialogPanel onBack={() => setShowAIDialog(false)} />}
          {!showPreviz && !showStoryboard && !showProductAutomation && !showAIDialog && !showWorkflow && !showPromptLibrary && currentGroup === 'image' && renderImageWorkspace()}
          {!showPreviz && !showStoryboard && !showProductAutomation && !showAIDialog && !showWorkflow && !showPromptLibrary && currentGroup === 'video' && <VideoGenerate />}
          {!showPreviz && !showStoryboard && !showProductAutomation && !showAIDialog && !showWorkflow && !showPromptLibrary && currentGroup === 'music' && <MusicGenerate />}
          {showWorkflow && !showStoryboard && !showProductAutomation && !showPreviz && <WorkflowPanel onBack={() => setShowWorkflow(false)} currentRole={currentRole} />}
          {showSettings && !showStoryboard && !showProductAutomation && !showPreviz && <SettingsPanel onBack={() => setShowSettings(false)} />}
          {showStyleManager && <StyleProfileManager onBack={() => setShowStyleManager(false)} onSelectProfile={(profile) => { setShowStyleManager(false); setCurrentGroup('image'); setCurrentMode('free'); setInjectedTemplate({ prompt: profile.promptTemplate, model: profile.parameters?.model, aspectRatio: profile.parameters?.aspectRatio, imageSize: profile.parameters?.imageSize }); }} />}
        </div>
      </div>

      {/* 新建模板弹窗 */}
      {showTemplateCreate && (
        <CreateTemplateModal
          onClose={() => setShowTemplateCreate(false)}
          onCreate={handleCreateTemplate}
        />
      )}
    </div>
  )
}

// 新建模板弹窗组件
const CreateTemplateModal = ({ onClose, onCreate }) => {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('file')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!name.trim()) {
      setError('请输入模板名称')
      return
    }
    setLoading(true)
    setError('')
    try {
      await onCreate({ name: name.trim(), icon, category, description })
    } catch (err) {
      setError(err.message || '创建失败')
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content create-template-modal">
        <div className="modal-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>新建模板</span>
          <button className="btn-back" onClick={onClose} style={{ border: 'none', background: 'transparent' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="section-label" style={{ marginTop: 12 }}>模板名称 *</div>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：新同事入职头像"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
        />

        <div className="section-label">图标</div>
        <div className="emoji-picker">
          {ICON_LIST.map((item) => {
            const ItemIcon = item.Icon
            return (
              <button
                key={item.key}
                className={`emoji-btn ${icon === item.key ? 'active' : ''}`}
                onClick={() => setIcon(item.key)}
              >
                <ItemIcon size={16} />
              </button>
            )
          })}
        </div>

        <div className="section-label">分类</div>
        <input
          className="input-field"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="例如：人事、市场、节日"
        />

        <div className="section-label">简介描述</div>
        <input
          className="input-field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简短描述模板用途（选填）"
        />

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-outline" style={{ flex: 1 }} onClick={onClose}>取消</button>
          <button className="generate-btn" style={{ flex: 1 }} onClick={handleSubmit} disabled={loading}>
            {loading ? '创建中...' : '创建模板'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
