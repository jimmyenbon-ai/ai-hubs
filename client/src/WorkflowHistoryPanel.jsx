import { useState, useEffect } from 'react';

export default function WorkflowHistoryPanel({ onBack }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchRuns();
  }, []);

  async function fetchRuns() {
    try {
      const resp = await fetch('/api/workflow/runs');
      const data = await resp.json();
      if (data.success) {
        setRuns(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchRunStatus(id) {
    try {
      const resp = await fetch(`/api/workflow/runs/${id}/status`);
      const data = await resp.json();
      if (data.success) {
        setRuns(prev => prev.map(r => r.id === id ? { ...r, status: data.data.status, steps: data.data.steps } : r));
        if (selectedRun?.id === id) {
          setSelectedRun(prev => prev ? { ...prev, status: data.data.status, steps: data.data.steps } : prev);
        }
        return data.data.status;
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
    return null;
  }

  useEffect(() => {
    const runningRuns = runs.filter(r => r.status === 'running');
    if (runningRuns.length === 0) return;

    const interval = setInterval(async () => {
      for (const run of runningRuns) {
        const status = await fetchRunStatus(run.id);
        if (status && status !== 'running') {
          // 不再这里清 interval，继续轮询直到全部完成
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runs.length]);

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatDuration(start, end) {
    if (!start || !end) return '-';
    const ms = new Date(end) - new Date(start);
    if (ms < 1000) return '<1s';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}min ${Math.round((ms % 60000) / 1000)}s`;
  }

  function getStatusBadge(status) {
    const configs = {
      running: { bg: '#3b82f6', label: '运行中', icon: '⏳' },
      completed: { bg: '#10b981', label: '已完成', icon: '✅' },
      failed: { bg: '#ef4444', label: '失败', icon: '❌' },
    };
    const config = configs[status] || configs.running;
    return (
      <span style={{
        background: config.bg,
        color: '#fff',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
      }}>
        {config.icon} {config.label}
      </span>
    );
  }

  const filteredRuns = runs.filter(r => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    const matchSearch = !searchQuery ||
      (r.template_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      JSON.stringify(r.inputs || {}).toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
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
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-outline" onClick={onBack}>← 返回</button>
          <span style={{ fontWeight: 600, fontSize: 16 }}>执行历史</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8 }}>
            {['all', 'running', 'completed', 'failed'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: '2px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  background: filterStatus === s
                    ? (s === 'all' ? 'var(--primary)' : s === 'running' ? '#3b82f6' : s === 'completed' ? '#10b981' : '#ef4444')
                    : 'var(--bg-tertiary)',
                  color: filterStatus === s ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid ' + (filterStatus === s ? 'transparent' : 'var(--border-color)'),
                  transition: 'all 0.15s',
                }}
              >
                {s === 'all' ? '全部' : s === 'running' ? '运行中' : s === 'completed' ? '已完成' : '失败'}
              </button>
            ))}
          </div>
        </div>
        <input
          className="input-field"
          style={{ width: 160, fontSize: 12 }}
          placeholder="搜索..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <button className="btn-outline" onClick={fetchRuns}>🔄 刷新</button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：历史列表 */}
        <div style={{
          width: 400,
          borderRight: '1px solid var(--border-color)',
          overflowY: 'auto',
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
              加载中...
            </div>
          ) : filteredRuns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                {(filterStatus !== 'all' || searchQuery) ? '没有找到匹配的执行记录' : '暂无执行记录'}
              </div>
            ) : (
              <div>
              {filteredRuns.map(run => (
              <div
                key={run.id}
                onClick={() => setSelectedRun(run)}
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  background: selectedRun?.id === run.id ? 'var(--bg-tertiary)' : 'transparent',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => {
                  if (selectedRun?.id !== run.id) {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                  }
                }}
                onMouseLeave={e => {
                  if (selectedRun?.id !== run.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>
                    {run.template_name || '未命名工作流'}
                  </span>
                  {getStatusBadge(run.status)}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatDate(run.started_at)}
                  {run.completed_at && ` · ${formatDuration(run.started_at, run.completed_at)}`}
                </div>
              </div>
              ))}
              </div>
            )}
        </div>

        {/* 右侧：详情 */}
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          {!selectedRun ? (
            <div style={{
              textAlign: 'center',
              padding: 60,
              color: 'var(--text-secondary)',
            }}>
              点击左侧记录查看详情
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <span style={{ fontWeight: 600, fontSize: 18 }}>
                  {selectedRun.template_name || '未命名工作流'}
                </span>
                {getStatusBadge(selectedRun.status)}
              </div>

              {/* 基本信息 */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
                marginBottom: 20,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>执行信息</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>开始时间：</span>
                    {formatDate(selectedRun.started_at)}
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>结束时间：</span>
                    {formatDate(selectedRun.completed_at) || (selectedRun.status === 'running' ? '进行中...' : '-')}
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>耗时：</span>
                    {formatDuration(selectedRun.started_at, selectedRun.completed_at)}
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>步骤数：</span>
                    {selectedRun.steps?.length || 0}
                  </div>
                </div>
              </div>

              {/* 输入 */}
              {selectedRun.inputs && Object.keys(selectedRun.inputs).length > 0 && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 10,
                  padding: 16,
                  marginBottom: 20,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>输入参数</div>
                  <div style={{ fontSize: 13 }}>
                    {Object.entries(selectedRun.inputs).map(([key, value]) => (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{key}：</span>
                        <span style={{
                          background: 'var(--bg-tertiary)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          wordBreak: 'break-all',
                        }}>
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 步骤详情 */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>执行步骤</div>
                {(!selectedRun.steps || selectedRun.steps.length === 0) ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>暂无步骤记录</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {selectedRun.steps.map((step, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--bg-tertiary)',
                          borderRadius: 8,
                          padding: 12,
                          borderLeft: `3px solid ${
                            step.output?.error ? '#ef4444' :
                            step.output?.imageUrl || step.output?.videoUrl || step.output?.audioUrl ? '#10b981' :
                            '#3b82f6'
                          }`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 500 }}>{step.nodeName || step.nodeType}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              {step.nodeType}
                            </span>
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {step.duration}ms
                          </span>
                        </div>

                        {/* 输出结果 */}
                        {step.output && (
                          <div style={{ marginTop: 8, fontSize: 13 }}>
                            {step.output.error && (
                              <div style={{ color: '#ef4444' }}>错误: {step.output.error}</div>
                            )}
                            {step.output.analysis && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>分析结果：</div>
                                <pre style={{
                                  background: 'var(--bg-primary)',
                                  padding: 8,
                                  borderRadius: 4,
                                  overflow: 'auto',
                                  fontSize: 12,
                                  maxHeight: 150,
                                }}>
                                  {typeof step.output.analysis === 'object'
                                    ? JSON.stringify(step.output.analysis, null, 2)
                                    : step.output.analysis}
                                </pre>
                              </div>
                            )}
                            {step.output.prompt && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>生成的提示词：</div>
                                <div style={{
                                  background: 'var(--bg-primary)',
                                  padding: 8,
                                  borderRadius: 4,
                                  whiteSpace: 'pre-wrap',
                                  fontSize: 12,
                                }}>
                                  {step.output.prompt}
                                </div>
                              </div>
                            )}
                            {step.output.copy && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>生成的文案：</div>
                                <div style={{
                                  background: 'var(--bg-primary)',
                                  padding: 8,
                                  borderRadius: 4,
                                  whiteSpace: 'pre-wrap',
                                  fontSize: 12,
                                }}>
                                  {step.output.copy}
                                </div>
                              </div>
                            )}
                            {step.output.imageUrl && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>生成的图片：</div>
                                <img
                                  src={step.output.imageUrl}
                                  alt="Generated"
                                  style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6 }}
                                />
                              </div>
                            )}
                            {step.output.videoUrl && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>生成的视频：</div>
                                <video
                                  src={step.output.videoUrl}
                                  controls
                                  style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6 }}
                                />
                              </div>
                            )}
                            {step.output.audioUrl && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>生成的音频：</div>
                                <audio src={step.output.audioUrl} controls style={{ width: '100%' }} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
