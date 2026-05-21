import { useState, useEffect } from 'react';

const CATEGORY_ICONS = {
  image: '🖼️',
  marketing: '📢',
  video: '🎬',
  music: '🎵',
  general: '⚙️',
};

export default function WorkflowListPanel({ onBack, onSelectWorkflow, onCreateWorkflow }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    try {
      const resp = await fetch('/api/workflow/templates');
      const data = await resp.json();
      if (data.success) {
        setTemplates(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除这个工作流？')) return;
    try {
      await fetch(`/api/workflow/templates/${id}`, { method: 'DELETE' });
      fetchTemplates();
    } catch (err) {
      alert('删除失败');
    }
  }

  const filteredTemplates = templates.filter(t => {
    const matchCategory = filterCategory === 'all' || t.category === filterCategory;
    const matchSearch = !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-color)',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-outline" onClick={onBack}>← 返回</button>
          <span style={{ fontWeight: 600, fontSize: 16 }}>工作流模板</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            ({filteredTemplates.length} 个)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input-field"
            style={{ width: 180 }}
            placeholder="搜索工作流..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select
            className="input-field"
            style={{ width: 130 }}
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="all">全部分类</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {CATEGORY_ICONS[c] || '📋'} {c}
              </option>
            ))}
          </select>
          <button className="generate-btn" onClick={onCreateWorkflow}>
            + 新建工作流
          </button>
        </div>
      </div>

      {/* 工作流列表 */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
            加载中...
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 60,
            color: 'var(--text-secondary)',
          }}>
            {searchQuery || filterCategory !== 'all'
              ? '没有找到匹配的工作流'
              : '暂无工作流，点击上方按钮创建'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {filteredTemplates.map(tpl => (
              <div
                key={tpl.id}
                style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 12,
                  padding: 20,
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, transform 0.2s',
                }}
                onClick={() => onSelectWorkflow(tpl)}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* 头部 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24 }}>
                      {CATEGORY_ICONS[tpl.category] || '⚙️'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{tpl.name}</span>
                  </div>
                  <button
                    className="btn-outline"
                    style={{ padding: '4px 8px', fontSize: 11, color: '#ef4444' }}
                    onClick={e => { e.stopPropagation(); handleDelete(tpl.id); }}
                  >
                    🗑️
                  </button>
                </div>

                {/* 描述 */}
                {tpl.description && (
                  <p style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    marginBottom: 12,
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {tpl.description}
                  </p>
                )}

                {/* 节点统计 */}
                <div style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-color)',
                }}>
                  <span>📊 {tpl.nodes?.length || 0} 个节点</span>
                  <span>🔗 {tpl.edges?.length || 0} 条连接</span>
                  {tpl.variables?.length > 0 && (
                    <span>📥 {tpl.variables.length} 个输入</span>
                  )}
                </div>

                {/* 节点类型标签 */}
                {tpl.nodes?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12 }}>
                    {[...new Set(tpl.nodes.map(n => n.type))].map(type => (
                      <span
                        key={type}
                        style={{
                          background: 'var(--bg-tertiary)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                )}

                {/* 操作按钮 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    className="btn-outline"
                    style={{ flex: 1, fontSize: 13 }}
                    onClick={e => { e.stopPropagation(); onSelectWorkflow(tpl); }}
                  >
                    ▶️ 打开
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
