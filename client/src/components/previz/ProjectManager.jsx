import { useEffect, useState } from 'react'

export default function ProjectManager({ actors, props, cameras, timeline, config, onClose, onLoad }) {
  const [projects, setProjects] = useState([])
  const [saveName, setSaveName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function fetchProjects() {
    try {
      const response = await fetch('/api/previz/projects')
      const data = await response.json()
      if (data.success) setProjects(data.data || [])
    } catch (_) {
      setProjects([])
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  async function handleSave() {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch('/api/previz/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName || `预演项目-${new Date().toLocaleDateString()}`,
          actors,
          props,
          cameras,
          timeline: timeline || [],
          config: config || {},
        }),
      })
      const data = await response.json()
      if (data.success) {
        setMessage(`已保存：${data.data.name}`)
        fetchProjects()
      } else {
        setMessage(`保存失败：${data.message || '未知错误'}`)
      }
    } catch (error) {
      setMessage(`网络错误：${error.message}`)
    }
    setLoading(false)
  }

  async function handleLoad(id) {
    setLoading(true)
    try {
      const response = await fetch(`/api/previz/projects/${id}`)
      const data = await response.json()
      if (data.success && onLoad) {
        onLoad(data.data)
        setMessage(`已加载：${data.data.name}`)
      }
    } catch (error) {
      setMessage(`加载失败：${error.message}`)
    }
    setLoading(false)
  }

  async function handleDelete(id) {
    if (!confirm('确认删除这个预演项目？')) return
    try {
      await fetch(`/api/previz/projects/${id}`, { method: 'DELETE' })
      setMessage('已删除')
      fetchProjects()
    } catch (error) {
      setMessage(`删除失败：${error.message}`)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal-content previz-project-modal">
        <div className="modal-header">
          <span style={{ fontWeight: 600 }}>项目保存 / 加载</span>
          <button className="btn-back" onClick={onClose}>X</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="section-label">保存当前项目</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input-field"
              style={{ flex: 1 }}
              placeholder="输入项目名称..."
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleSave() }}
            />
            <button className="generate-btn" onClick={handleSave} disabled={loading}>
              {loading ? '...' : '保存'}
            </button>
          </div>
          {message && <p style={{ fontSize: 12, color: '#10b981', marginTop: 6 }}>{message}</p>}
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="section-label">加载项目（{projects.length}）</label>
          <div className="previz-project-list">
            {projects.length === 0 && <p style={{ fontSize: 12, color: '#666' }}>暂无保存的项目</p>}
            {projects.map((project) => (
              <div key={project.id} className="previz-project-item">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{project.name}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>
                    {project.actorCount} 个角色 · {project.propCount} 个道具 · {new Date(project.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => handleLoad(project.id)} disabled={loading}>加载</button>
                <button className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => handleDelete(project.id)}>删</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
