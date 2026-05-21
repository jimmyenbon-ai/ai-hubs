import { useState, useEffect, useCallback } from 'react';

const DEFAULT_FOLDERS = [
  { path: 'product', name: '产品', icon: '📦' },
  { path: 'company', name: '公司', icon: '🏢' },
  { path: 'design', name: '设计素材', icon: '🎨' },
  { path: 'brand', name: '品牌', icon: '🏷️' },
  { path: 'other', name: '其他', icon: '📌' },
];

export default function KnowledgePanel({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterFolder, setFilterFolder] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [folders, setFolders] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [form, setForm] = useState({
    category: 'product',
    folder: '',
    title: '',
    originalName: '',
    content: '',
    fileUrl: '',
    type: 'text',
    metadata: '',
  });

  // 文件上传相关
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetchItems();
    fetchFolders();
  }, []);

  async function fetchItems() {
    try {
      const resp = await fetch('/api/knowledge');
      const data = await resp.json();
      if (data.success) setItems(data.data);
    } catch (err) {
      console.error('Failed to fetch items:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchFolders() {
    try {
      const resp = await fetch('/api/knowledge/folders');
      const data = await resp.json();
      if (data.success && data.data.length > 0) {
        setFolders(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    }
  }

  const filteredItems = items.filter(item => {
    if (filterFolder !== 'all') {
      const kf = (item.folder || item.category || '').replace(/\/$/, '');
      if (kf !== filterFolder && !kf.startsWith(filterFolder + '/')) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (item.title || '').toLowerCase().includes(q) ||
        (item.originalName || '').toLowerCase().includes(q) ||
        (item.content || '').toLowerCase().includes(q) ||
        (item.folder || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // 统计每个文件夹的数量
  const folderStats = {};
  for (const item of items) {
    const f = item.folder || item.category || 'other';
    folderStats[f] = (folderStats[f] || 0) + 1;
  }
  const totalAll = items.length;

  function resetForm() {
    setForm({ category: 'product', folder: '', title: '', originalName: '', content: '', fileUrl: '', type: 'text', metadata: '' });
    setEditingId(null);
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.content.trim()) {
      alert('请填写标题和内容');
      return;
    }

    try {
      let metadata = {};
      try {
        if (form.metadata.trim()) metadata = JSON.parse(form.metadata);
      } catch { metadata = {}; }

      const body = {
        category: form.category,
        folder: form.folder || form.category,
        title: form.title.trim(),
        originalName: form.originalName || form.title.trim(),
        content: form.content.trim(),
        fileUrl: form.fileUrl || null,
        type: form.type || 'text',
        metadata,
      };

      const url = editingId ? `/api/knowledge/${editingId}` : '/api/knowledge';
      const method = editingId ? 'PUT' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (data.success) {
        fetchItems();
        fetchFolders();
        setShowForm(false);
        resetForm();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  }

  function handleEdit(item) {
    setForm({
      category: item.category || 'product',
      folder: item.folder || item.category || '',
      title: item.title || '',
      originalName: item.originalName || '',
      content: item.content || '',
      fileUrl: item.fileUrl || '',
      type: item.type || 'text',
      metadata: item.metadata ? JSON.stringify(item.metadata, null, 2) : '',
    });
    setEditingId(item.id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    if (!confirm('确定删除这条知识？')) return;
    try {
      await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      fetchItems();
      fetchFolders();
    } catch (err) {
      alert('删除失败');
    }
  }

  async function handleMoveToFolder(targetFolder) {
    if (selectedItems.size === 0) return;
    try {
      const resp = await fetch('/api/knowledge/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedItems], folder: targetFolder }),
      });
      const data = await resp.json();
      if (data.success) {
        setSelectedItems(new Set());
        fetchItems();
        fetchFolders();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('移动失败: ' + err.message);
    }
  }

  function handleSelectFolder(folder) {
    setFilterFolder(folder);
    setSearchQuery('');
  }

  function toggleSelectItem(id) {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 添加文件到待传队列
  function addFiles(fileList) {
    const incoming = [...fileList].filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      const allowed = ['.txt', '.md', '.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
      return allowed.includes(ext);
    });
    if (incoming.length < fileList.length) {
      setUploadProgress(`已过滤 ${fileList.length - incoming.length} 个不支持的文件`);
    }
    setPendingFiles(prev => [...prev, ...incoming]);
  }

  function removePendingFile(index) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  // 上传待传队列中的所有文件
  async function uploadPendingFiles() {
    if (pendingFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(`正在上传 ${pendingFiles.length} 个文件...`);

    try {
      const formData = new FormData();
      pendingFiles.forEach(f => formData.append('files', f));
      if (filterFolder !== 'all') {
        formData.append('folder', filterFolder);
      }

      const resp = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await resp.json();

      if (data.success && data.data?.length > 0) {
        const results = data.data;

        if (results.length === 1) {
          // 单文件：预填表单以便编辑
          const result = results[0];
          setPendingFiles([]);
          setEditingId(result.id);
          setForm({
            category: result.folder?.split('/')[0] || 'product',
            folder: result.folder || (filterFolder !== 'all' ? filterFolder : ''),
            title: result.title || '',
            originalName: result.originalName || '',
            content: result.content || '',
            fileUrl: result.fileUrl || '',
            type: result.type || 'text',
            metadata: '',
          });
          setUploadProgress('上传成功，请确认内容后保存');
          setShowForm(true);
        } else {
          // 批量：全部自动保存，刷新列表
          setPendingFiles([]);
          setUploadProgress(`成功上传 ${results.length} 个文件`);
          fetchItems();
          fetchFolders();
        }
      } else {
        setUploadProgress('上传失败: ' + (data.message || '请重试'));
      }
    } catch (err) {
      setUploadProgress('上传失败: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  // 拖拽事件
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }

  // 构建文件夹列表（已有数据的文件夹 + 预设文件夹）
  const folderList = [...new Set([...DEFAULT_FOLDERS.map(f => f.path), ...folders])].map(path => {
    const preset = DEFAULT_FOLDERS.find(f => f.path === path);
    return {
      path,
      name: preset?.name || path,
      icon: preset?.icon || '📁',
    };
  });

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
          <button onClick={onBack} style={{
            background: 'transparent', border: '1px solid var(--border-color)',
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: 13,
          }}>← 返回</button>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>📚 知识库</h2>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="搜索知识（含文件夹和文件名）..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 6, padding: '6px 12px', fontSize: 13, color: 'var(--text-primary)',
              width: 200,
            }}
          />
          <button onClick={() => { resetForm(); setShowForm(true); }}
            style={{
              background: 'var(--primary-color)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
            }}>
            + 添加知识
          </button>
        </div>
      </div>

      {/* 批量操作栏 */}
      {selectedItems.size > 0 && (
        <div style={{
          padding: '8px 20px', background: 'var(--primary-color-bg, rgba(99,102,241,0.1))',
          borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12,
          fontSize: 13,
        }}>
          <span style={{ color: 'var(--text-primary)' }}>已选 {selectedItems.size} 项</span>
          <select
            value=""
            onChange={e => { if (e.target.value) handleMoveToFolder(e.target.value); e.target.value = ''; }}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 4, padding: '4px 8px', fontSize: 12, color: 'var(--text-primary)',
            }}
          >
            <option value="">移动到文件夹...</option>
            {folderList.map(f => (
              <option key={f.path} value={f.path}>{f.icon} {f.name}</option>
            ))}
          </select>
          <button
            onClick={() => setSelectedItems(new Set())}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}
          >
            取消选择
          </button>
        </div>
      )}

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧文件夹导航 */}
        <div style={{
          width: 200,
          borderRight: '1px solid var(--border-color)',
          padding: '12px 8px',
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          {/* 全部 */}
          <FolderItem
            icon="📁"
            name="全部知识"
            count={totalAll}
            active={filterFolder === 'all'}
            onClick={() => handleSelectFolder('all')}
          />

          <div style={{ height: 1, background: 'var(--border-color)', margin: '8px 0' }} />

          {/* 动态文件夹列表 */}
          {folderList.map(f => (
            <FolderItem
              key={f.path}
              icon={f.icon}
              name={f.name}
              sub={f.path}
              count={folderStats[f.path] || 0}
              active={filterFolder === f.path}
              onClick={() => handleSelectFolder(f.path)}
            />
          ))}

          {folderList.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 8 }}>
              暂无文件夹，上传或添加知识后自动创建
            </div>
          )}
        </div>

        {/* 右侧知识列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* 拖拽上传区域 */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? 'var(--primary-color)' : 'var(--border-color)'}`,
              borderRadius: 10,
              padding: '16px 20px',
              marginBottom: 16,
              background: dragOver ? 'var(--primary-color-bg, rgba(99,102,241,0.08))' : 'var(--bg-secondary)',
              transition: 'all 0.2s',
              textAlign: 'center',
            }}
          >
            {pendingFiles.length === 0 && !uploading ? (
              <div>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
                  拖拽文件到此处上传
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  支持 TXT、MD、PDF、Word、图片
                </div>
                <label style={{
                  ...uploadBtnStyle, cursor: 'pointer', display: 'inline-flex',
                }}>
                  📎 选择文件
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.svg"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                  />
                </label>
              </div>
            ) : (
              <div>
                {/* 待传文件列表 */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12,
                  justifyContent: 'center',
                }}>
                  {pendingFiles.map((f, i) => (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                      borderRadius: 6, padding: '4px 10px', fontSize: 12,
                      color: 'var(--text-primary)',
                    }}>
                      {f.name.length > 28 ? f.name.substring(0, 28) + '…' : f.name}
                      <span
                        onClick={() => removePendingFile(i)}
                        style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1 }}
                        title="移除"
                      >×</span>
                    </span>
                  ))}
                  {/* 继续添加 */}
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'transparent', border: '1px dashed var(--border-color)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}>
                    + 添加
                    <input
                      type="file"
                      accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.svg"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                    />
                  </label>
                </div>

                {/* 上传按钮 */}
                <button
                  onClick={uploadPendingFiles}
                  disabled={uploading}
                  style={{
                    background: 'var(--primary-color)', color: '#fff', border: 'none',
                    borderRadius: 6, padding: '8px 24px', fontSize: 14, cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {uploading ? `⏳ ${uploadProgress}` : `上传 ${pendingFiles.length} 个文件`}
                </button>
              </div>
            )}

            {/* 上传中进度（无队列时） */}
            {uploading && pendingFiles.length === 0 && (
              <span style={{ color: 'var(--primary-color)', fontSize: 12 }}>
                ⏳ {uploadProgress}
              </span>
            )}
          </div>

          {/* 统计 */}
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {filterFolder === 'all'
              ? `共 ${totalAll} 条知识`
              : `${filterFolder} ${filteredItems.length} 条`}
          </div>

          {/* 列表 */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              加载中...
            </div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              {filterFolder === 'all' ? '知识库为空，点击"添加知识"或上传文件开始' : '该文件夹暂无知识'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredItems.map(item => (
                <KnowledgeItem
                  key={item.id}
                  item={item}
                  selected={selectedItems.has(item.id)}
                  onToggleSelect={() => toggleSelectItem(item.id)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 添加/编辑弹窗 */}
      {showForm && (
        <KnowledgeFormModal
          form={form}
          setForm={setForm}
          editingId={editingId}
          folders={folderList}
          onSubmit={handleSubmit}
          onClose={() => { setShowForm(false); resetForm(); }}
        />
      )}
    </div>
  );
}

// ========== 子组件 ==========

function FolderItem({ icon, name, sub, count, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? 'var(--primary-color-bg, rgba(99,102,241,0.1))' : 'transparent',
        color: active ? 'var(--primary-color)' : 'var(--text-primary)',
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover-bg, rgba(128,128,128,0.1))'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{name}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      <span style={{
        fontSize: 11, background: active ? 'var(--primary-color)' : 'var(--bg-secondary)',
        color: active ? '#fff' : 'var(--text-secondary)',
        borderRadius: 10, padding: '1px 7px',
      }}>
        {count}
      </span>
    </div>
  );
}

function KnowledgeItem({ item, selected, onToggleSelect, onEdit, onDelete }) {
  const isImage = item.type === 'image' && item.fileUrl;
  const folderTag = item.folder || item.category || '';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      background: selected ? 'var(--primary-color-bg, rgba(99,102,241,0.15))' : 'var(--bg-secondary)',
      borderRadius: 8,
      border: selected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
    }}>
      {/* 选择框 */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        style={{ flexShrink: 0, cursor: 'pointer' }}
      />

      {/* 图标或图片预览 */}
      <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 6, overflow: 'hidden', background: '#333' }}>
        {isImage ? (
          <img
            src={item.fileUrl}
            alt={item.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 20,
          }}>
            {item.type === 'image' ? '🖼️' : '📄'}
          </div>
        )}
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
            {item.title}
          </span>
          {item.originalName && item.originalName !== item.title && (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              {item.originalName}
            </span>
          )}
          {folderTag && (
            <span style={{
              fontSize: 10, background: 'var(--primary-color-bg, rgba(99,102,241,0.1))',
              color: 'var(--primary-color)', borderRadius: 4, padding: '1px 6px',
            }}>
              📁 {folderTag}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.content?.substring(0, 80)}
        </div>
      </div>

      {/* 操作 */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={() => onEdit(item)} style={iconBtnStyle}>✏️</button>
        <button onClick={() => onDelete(item.id)} style={iconBtnStyle}>🗑️</button>
      </div>
    </div>
  );
}

function KnowledgeFormModal({ form, setForm, editingId, folders, onSubmit, onClose }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 100, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 12, padding: 24,
        width: 500, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>
          {editingId ? '编辑知识' : '添加知识'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 文件夹 */}
          <div>
            <label style={labelStyle}>文件夹</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={form.folder || form.category}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value, category: e.target.value.split('/')[0] || 'other' }))}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">选择文件夹...</option>
                {folders.map(f => (
                  <option key={f.path} value={f.path}>{f.icon} {f.name} ({f.path})</option>
                ))}
              </select>
              <input
                value={form.folder}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
                placeholder="或自定义路径，如 design/海报"
                style={{ ...inputStyle, flex: 2 }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              LLM 会根据文件夹和文件名语义快速定位知识（如 brand/logo、product/BPro、design/海报）
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label style={labelStyle}>标题 *</label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="例如：BPro 核心功能介绍"
              style={inputStyle}
            />
          </div>

          {/* 文件名（原始） */}
          <div>
            <label style={labelStyle}>原始文件名</label>
            <input
              value={form.originalName || ''}
              onChange={e => setForm(f => ({ ...f, originalName: e.target.value }))}
              placeholder="保留原始文件名，便于 LLM 搜索定位"
              style={inputStyle}
            />
          </div>

          {/* 内容 */}
          <div>
            <label style={labelStyle}>内容 *</label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="输入知识内容..."
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          {/* 图片预览 */}
          {form.fileUrl && (
            <div>
              <label style={labelStyle}>图片预览</label>
              <img
                src={form.fileUrl}
                alt="preview"
                style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: '1px solid var(--border-color)' }}
              />
            </div>
          )}

          {/* 附加信息 */}
          <div>
            <label style={labelStyle}>附加信息（JSON格式）</label>
            <textarea
              value={form.metadata}
              onChange={e => setForm(f => ({ ...f, metadata: e.target.value }))}
              placeholder='{"key": "value"}'
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
        </div>

        {/* 按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={cancelBtnStyle}>取消</button>
          <button onClick={onSubmit} style={submitBtnStyle}>
            {editingId ? '保存修改' : '确认保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== 样式 ==========
const uploadBtnStyle = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
  borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
  color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6,
};

const iconBtnStyle = {
  background: 'transparent', border: '1px solid var(--border-color)',
  borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13,
};

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6,
  color: 'var(--text-secondary)',
};

const inputStyle = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
  borderRadius: 6, padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)',
  boxSizing: 'border-box',
  outline: 'none',
};

const cancelBtnStyle = {
  background: 'transparent', border: '1px solid var(--border-color)',
  borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
  color: 'var(--text-secondary)',
};

const submitBtnStyle = {
  background: 'var(--primary-color)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer',
};
