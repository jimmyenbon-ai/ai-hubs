import { useEffect, useState } from 'react'
import './EnterpriseWorkspace.css'
import {
  ENTERPRISE_TASKS,
  calculateWorkspaceReadiness,
  createEnterpriseId,
  loadEnterpriseWorkspace,
  saveEnterpriseWorkspace,
} from './enterpriseWorkspaceStore'

const TABS = [
  { id: 'overview', label: '总览' },
  { id: 'projects', label: '项目中心' },
  { id: 'knowledge', label: '知识与品牌' },
  { id: 'roles', label: '岗位 AI' },
  { id: 'deployment', label: '企业配置' },
]

const PROJECT_STATUSES = ['规划中', '进行中', '待审核', '已完成']

function MetricCard({ label, value, hint, accent }) {
  return (
    <article className={`enterprise-metric enterprise-accent-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function EmptyState({ title, description }) {
  return (
    <div className="enterprise-empty">
      <span>＋</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

export default function EnterpriseWorkspace({ onBack, onLaunchTool }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [workspace, setWorkspace] = useState(loadEnterpriseWorkspace)
  const [projectDraft, setProjectDraft] = useState({ name: '', objective: '', owner: '' })
  const [knowledgeDraft, setKnowledgeDraft] = useState({ title: '', type: '产品资料', description: '' })

  useEffect(() => {
    saveEnterpriseWorkspace(workspace)
  }, [workspace])

  const readiness = calculateWorkspaceReadiness(workspace)
  const activeProjects = workspace.projects.filter((project) => project.status !== '已完成').length
  const enabledRoles = workspace.aiRoles.filter((role) => role.enabled).length
  const completedProjects = workspace.projects.filter((project) => project.status === '已完成').length

  function patchOrganization(field, value) {
    setWorkspace((current) => ({
      ...current,
      organization: { ...current.organization, [field]: value },
    }))
  }

  function patchBrand(field, value) {
    setWorkspace((current) => ({
      ...current,
      brandProfile: { ...current.brandProfile, [field]: value },
    }))
  }

  function handleTask(task) {
    if (task.tool === 'project') {
      setActiveTab('projects')
      return
    }
    const run = {
      id: createEnterpriseId('task'),
      taskId: task.id,
      title: task.title,
      tool: task.tool,
      projectId: workspace.activeProjectId,
      createdAt: new Date().toLocaleString('zh-CN'),
    }
    const nextWorkspace = {
      ...workspace,
      taskHistory: [run, ...workspace.taskHistory].slice(0, 30),
    }
    // This action immediately unmounts the enterprise workspace. Persist in
    // the event before navigation so the task history cannot be lost.
    saveEnterpriseWorkspace(nextWorkspace)
    setWorkspace(nextWorkspace)
    onLaunchTool?.(task.tool, run)
  }

  function handleCreateProject(event) {
    event.preventDefault()
    const name = projectDraft.name.trim()
    if (!name) return
    const project = {
      id: createEnterpriseId('project'),
      name,
      type: '内容营销',
      owner: projectDraft.owner.trim() || '待分配',
      status: '规划中',
      progress: 0,
      objective: projectDraft.objective.trim() || '待补充项目目标',
      updatedAt: new Date().toLocaleDateString('zh-CN'),
    }
    setWorkspace((current) => ({
      ...current,
      activeProjectId: project.id,
      projects: [project, ...current.projects],
    }))
    setProjectDraft({ name: '', objective: '', owner: '' })
  }

  function updateProject(projectId, patch) {
    setWorkspace((current) => ({
      ...current,
      activeProjectId: projectId,
      projects: current.projects.map((project) => (
        project.id === projectId ? { ...project, ...patch, updatedAt: new Date().toLocaleDateString('zh-CN') } : project
      )),
    }))
  }

  function handleAddKnowledge(event) {
    event.preventDefault()
    const title = knowledgeDraft.title.trim()
    if (!title) return
    const source = {
      id: createEnterpriseId('knowledge'),
      title,
      type: knowledgeDraft.type,
      description: knowledgeDraft.description.trim(),
      status: '待接入',
      updatedAt: new Date().toLocaleDateString('zh-CN'),
    }
    setWorkspace((current) => ({
      ...current,
      knowledgeSources: [source, ...current.knowledgeSources],
    }))
    setKnowledgeDraft({ title: '', type: '产品资料', description: '' })
  }

  function toggleRole(roleId) {
    setWorkspace((current) => ({
      ...current,
      aiRoles: current.aiRoles.map((role) => (
        role.id === roleId ? { ...role, enabled: !role.enabled } : role
      )),
    }))
  }

  function updateRolePolicy(roleId, modelPolicy) {
    setWorkspace((current) => ({
      ...current,
      aiRoles: current.aiRoles.map((role) => (
        role.id === roleId ? { ...role, modelPolicy } : role
      )),
    }))
  }

  return (
    <main className="enterprise-workspace">
      <header className="enterprise-header">
        <div className="enterprise-header-copy">
          <button type="button" className="enterprise-back" onClick={onBack}>← 返回通用工作台</button>
          <div className="enterprise-eyebrow">ENTERPRISE AI WORKSPACE · V1</div>
          <h1>{workspace.organization.workspaceName}</h1>
          <p>把企业知识、品牌规范、岗位 AI 与现有内容生产工具组织成统一业务入口。</p>
        </div>
        <div className="enterprise-header-status">
          <span className="enterprise-compatibility">兼容模式</span>
          <strong>{workspace.organization.name}</strong>
          <small>现有工具与历史数据保持不变</small>
        </div>
      </header>

      <nav className="enterprise-tabs" aria-label="企业工作台模块">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <span className="enterprise-save-state">自动保存到本机</span>
      </nav>

      {activeTab === 'overview' && (
        <section className="enterprise-section">
          <div className="enterprise-welcome-grid">
            <article className="enterprise-welcome-card">
              <div>
                <span className="enterprise-kicker">企业配置完成度</span>
                <h2>{readiness}%</h2>
                <p>补充企业资料、品牌规则和知识来源后，岗位 AI 才能持续输出一致结果。</p>
              </div>
              <div className="enterprise-progress-ring" style={{ '--progress': `${readiness * 3.6}deg` }}>
                <strong>{readiness}</strong><span>%</span>
              </div>
              <button type="button" onClick={() => setActiveTab('knowledge')}>继续配置企业大脑</button>
            </article>

            <div className="enterprise-metrics">
              <MetricCard label="进行中项目" value={activeProjects} hint="跨工具统一归档" accent="violet" />
              <MetricCard label="已启用岗位 AI" value={enabledRoles} hint="按部门分配能力" accent="cyan" />
              <MetricCard label="知识来源" value={workspace.knowledgeSources.length} hint="等待接入企业资料" accent="blue" />
              <MetricCard label="已完成项目" value={completedProjects} hint="沉淀为可复用模板" accent="green" />
            </div>
          </div>

          <div className="enterprise-section-heading">
            <div>
              <span className="enterprise-kicker">BUSINESS TASKS</span>
              <h2>今天要完成什么？</h2>
              <p>员工选择业务任务，系统在后台调用现有 AI 工具。</p>
            </div>
          </div>
          <div className="enterprise-task-grid">
            {ENTERPRISE_TASKS.map((task) => (
              <article key={task.id} className={`enterprise-task-card enterprise-accent-${task.accent}`}>
                <span className="enterprise-task-category">{task.category}</span>
                <h3>{task.title}</h3>
                <p>{task.description}</p>
                <button type="button" onClick={() => handleTask(task)}>开始任务 <span>→</span></button>
              </article>
            ))}
          </div>

          <div className="enterprise-recent-grid">
            <section className="enterprise-panel">
              <div className="enterprise-panel-title">
                <h3>最近项目</h3>
                <button type="button" onClick={() => setActiveTab('projects')}>查看全部</button>
              </div>
              {workspace.projects.slice(0, 3).map((project) => (
                <button
                  type="button"
                  className="enterprise-project-row"
                  key={project.id}
                  onClick={() => { setWorkspace((current) => ({ ...current, activeProjectId: project.id })); setActiveTab('projects') }}
                >
                  <span className="enterprise-project-mark" />
                  <span><strong>{project.name}</strong><small>{project.objective}</small></span>
                  <em>{project.status}</em>
                </button>
              ))}
            </section>
            <section className="enterprise-panel">
              <div className="enterprise-panel-title">
                <h3>最近启动的任务</h3>
              </div>
              {workspace.taskHistory.length ? workspace.taskHistory.slice(0, 4).map((run) => (
                <div className="enterprise-history-row" key={run.id}>
                  <span>{run.title}</span><small>{run.createdAt}</small>
                </div>
              )) : <EmptyState title="还没有执行记录" description="从上方选择一个业务任务开始。" />}
            </section>
          </div>
        </section>
      )}

      {activeTab === 'projects' && (
        <section className="enterprise-section enterprise-two-column">
          <div className="enterprise-main-column">
            <div className="enterprise-section-heading">
              <div><span className="enterprise-kicker">PROJECT HUB</span><h2>项目中心</h2><p>把跨图片、视频、文案和3D的成果放在同一个项目上下文中。</p></div>
            </div>
            <div className="enterprise-project-list">
              {workspace.projects.map((project) => (
                <article key={project.id} className={`enterprise-project-card ${workspace.activeProjectId === project.id ? 'active' : ''}`}>
                  <button type="button" className="enterprise-project-select" onClick={() => setWorkspace((current) => ({ ...current, activeProjectId: project.id }))}>
                    <span>{project.type}</span><h3>{project.name}</h3><p>{project.objective}</p>
                  </button>
                  <div className="enterprise-project-meta"><span>负责人：{project.owner}</span><span>更新：{project.updatedAt}</span></div>
                  <div className="enterprise-project-progress"><span style={{ width: `${project.progress}%` }} /></div>
                  <div className="enterprise-project-actions">
                    <select value={project.status} onChange={(event) => updateProject(project.id, { status: event.target.value })}>
                      {PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <label>进度 <input type="range" min="0" max="100" value={project.progress} onChange={(event) => updateProject(project.id, { progress: Number(event.target.value) })} /></label>
                    <strong>{project.progress}%</strong>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <aside className="enterprise-side-panel">
            <h3>新建项目</h3>
            <p>先建立业务目标，后续生成内容会逐步关联到该项目。</p>
            <form onSubmit={handleCreateProject}>
              <label>项目名称<input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：2026夏季新品发布" /></label>
              <label>负责人<input value={projectDraft.owner} onChange={(event) => setProjectDraft((current) => ({ ...current, owner: event.target.value }))} placeholder="姓名或部门" /></label>
              <label>项目目标<textarea value={projectDraft.objective} onChange={(event) => setProjectDraft((current) => ({ ...current, objective: event.target.value }))} placeholder="描述目标客户、渠道和期望交付物" /></label>
              <button type="submit" disabled={!projectDraft.name.trim()}>创建项目</button>
            </form>
          </aside>
        </section>
      )}

      {activeTab === 'knowledge' && (
        <section className="enterprise-section enterprise-two-column">
          <div className="enterprise-main-column">
            <div className="enterprise-section-heading">
              <div><span className="enterprise-kicker">COMPANY CONTEXT</span><h2>企业知识与品牌</h2><p>V1 先建立知识目录和品牌规则，后续接入真实文档向量库与权限系统。</p></div>
            </div>
            <div className="enterprise-form-grid">
              <label>企业名称<input value={workspace.organization.name} onChange={(event) => patchOrganization('name', event.target.value)} /></label>
              <label>所属行业<input value={workspace.organization.industry} onChange={(event) => patchOrganization('industry', event.target.value)} /></label>
              <label className="span-two">品牌口号<input value={workspace.organization.slogan} onChange={(event) => patchOrganization('slogan', event.target.value)} placeholder="一句话说明企业价值" /></label>
              <label className="span-two">品牌语气<textarea value={workspace.brandProfile.tone} onChange={(event) => patchBrand('tone', event.target.value)} placeholder="例如：专业、克制、可信，避免夸张承诺" /></label>
              <label>品牌主色<input type="color" value={workspace.brandProfile.primaryColor} onChange={(event) => patchBrand('primaryColor', event.target.value)} /></label>
              <label>品牌辅色<input type="color" value={workspace.brandProfile.secondaryColor} onChange={(event) => patchBrand('secondaryColor', event.target.value)} /></label>
              <label className="span-two">品牌关键词<input value={workspace.brandProfile.keywords.join('、')} onChange={(event) => patchBrand('keywords', event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))} placeholder="专业、可靠、高效" /></label>
              <label className="span-two">禁用词<input value={workspace.brandProfile.bannedWords.join('、')} onChange={(event) => patchBrand('bannedWords', event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))} placeholder="绝对化用词、违规承诺等" /></label>
            </div>

            <div className="enterprise-panel enterprise-knowledge-list">
              <div className="enterprise-panel-title"><h3>知识来源目录</h3><span>{workspace.knowledgeSources.length} 项</span></div>
              {workspace.knowledgeSources.length ? workspace.knowledgeSources.map((source) => (
                <div className="enterprise-knowledge-row" key={source.id}>
                  <span className="enterprise-file-badge">{source.type.slice(0, 1)}</span>
                  <span><strong>{source.title}</strong><small>{source.description || '暂无说明'} · {source.updatedAt}</small></span>
                  <em>{source.status}</em>
                </div>
              )) : <EmptyState title="尚未登记企业资料" description="先在右侧添加产品、品牌、案例或制度资料目录。" />}
            </div>
          </div>
          <aside className="enterprise-side-panel">
            <h3>登记知识来源</h3>
            <p>当前只保存资料目录，不会改动现有知识库。后续版本再接入上传、切片和权限。</p>
            <form onSubmit={handleAddKnowledge}>
              <label>资料名称<input value={knowledgeDraft.title} onChange={(event) => setKnowledgeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：2026产品手册" /></label>
              <label>资料类型<select value={knowledgeDraft.type} onChange={(event) => setKnowledgeDraft((current) => ({ ...current, type: event.target.value }))}><option>产品资料</option><option>品牌规范</option><option>客户案例</option><option>运营规则</option><option>内部制度</option><option>销售话术</option></select></label>
              <label>用途说明<textarea value={knowledgeDraft.description} onChange={(event) => setKnowledgeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="哪些岗位可以使用，以及用于什么任务" /></label>
              <button type="submit" disabled={!knowledgeDraft.title.trim()}>添加到目录</button>
            </form>
          </aside>
        </section>
      )}

      {activeTab === 'roles' && (
        <section className="enterprise-section">
          <div className="enterprise-section-heading">
            <div><span className="enterprise-kicker">ROLE-BASED AI</span><h2>岗位 AI</h2><p>员工选择岗位和任务，不需要理解模型、参数或提示词工程。</p></div>
          </div>
          <div className="enterprise-role-grid">
            {workspace.aiRoles.map((role) => (
              <article className={`enterprise-role-card ${role.enabled ? 'enabled' : ''}`} key={role.id}>
                <div className="enterprise-role-heading">
                  <span>{role.name.slice(0, 1)}</span>
                  <div><small>{role.department}</small><h3>{role.name}</h3></div>
                  <button type="button" className={`enterprise-switch ${role.enabled ? 'on' : ''}`} onClick={() => toggleRole(role.id)} aria-label={`${role.enabled ? '停用' : '启用'}${role.name}`}><span /></button>
                </div>
                <p>{role.description}</p>
                <div className="enterprise-role-tools">{role.tools.map((tool) => <span key={tool}>{tool}</span>)}</div>
                <label>模型策略<select value={role.modelPolicy} onChange={(event) => updateRolePolicy(role.id, event.target.value)}><option>企业默认模型</option><option>视觉优先模型</option><option>长上下文导演模型</option><option>低成本快速模型</option><option>高质量推理模型</option></select></label>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'deployment' && (
        <section className="enterprise-section">
          <div className="enterprise-section-heading">
            <div><span className="enterprise-kicker">DEPLOYMENT FOUNDATION</span><h2>企业配置</h2><p>V1 使用兼容层建立产品结构，权限、审计和私有化服务将在后续阶段接入。</p></div>
          </div>
          <div className="enterprise-deployment-grid">
            <article className="enterprise-deployment-card ready"><span>01</span><h3>现有生产工具</h3><p>图片、视频、音乐、工作流、产品图和3D导演继续沿用原页面。</p><em>已兼容</em></article>
            <article className="enterprise-deployment-card ready"><span>02</span><h3>企业配置基座</h3><p>组织、品牌、项目、知识目录和岗位AI使用版本化本地结构。</p><em>V1 已启用</em></article>
            <article className="enterprise-deployment-card"><span>03</span><h3>多租户与权限</h3><p>企业、部门、成员、角色、知识权限和模型额度隔离。</p><em>下一阶段</em></article>
            <article className="enterprise-deployment-card"><span>04</span><h3>私有知识服务</h3><p>文档上传、切片、检索、引用、更新和权限过滤。</p><em>下一阶段</em></article>
            <article className="enterprise-deployment-card"><span>05</span><h3>审核与交付</h3><p>草稿、待审、版本对比、品牌检查和最终交付包。</p><em>规划中</em></article>
            <article className="enterprise-deployment-card"><span>06</span><h3>部署与审计</h3><p>SSO、操作日志、对象存储、备份、模型成本与离线部署。</p><em>规划中</em></article>
          </div>
        </section>
      )}
    </main>
  )
}
