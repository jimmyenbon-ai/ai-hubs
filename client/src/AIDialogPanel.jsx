import { useState, useEffect, useRef } from 'react';
import { Icon } from './components/Icons';

const M = Icon;

export default function AIDialogPanel({ onBack }) {
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // SSE 实时状态
  const [progressSteps, setProgressSteps] = useState([]);
  const [liveImages, setLiveImages] = useState([]);
  const [liveText, setLiveText] = useState('');

  async function fetchConversations() {
    try {
      const resp = await fetch('/api/ai-dialog/conversations');
      const data = await resp.json();
      if (data.success) setConversations(data.data);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }

  async function loadConversation(id) {
    try {
      const resp = await fetch(`/api/ai-dialog/conversations/${id}`);
      const data = await resp.json();
      if (data.success) {
        setCurrentConversation(data.data.conversation);
        setMessages(data.data.messages);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }

  useEffect(() => { fetchConversations(); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveImages, liveText, progressSteps]);

  async function handleSend() {
    if (!input.trim() || status === 'loading') return;
    const userMessage = input.trim();
    setInput('');
    setStatus('loading');
    setError(null);

    setProgressSteps([]);
    setLiveImages([]);
    setLiveText('');

    const optimisticUserMsg = { id: 'temp-' + Date.now(), role: 'user', content: userMessage, attachments: [] };
    setMessages(prev => [...prev, optimisticUserMsg]);

    let convId = currentConversation?.id;

    try {
      const resp = await fetch('/api/ai-dialog/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, message: userMessage }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ message: `HTTP ${resp.status}` }));
        throw new Error(errData.message || `请求失败 (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 正则匹配 SSE 事件：event: xxx\ndata: yyy\n\n
      const eventRe = /event: ([^\n]+)\ndata: ([\s\S]*?)(?=\n\n|$)/g;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let match;
        const consumedRanges = [];

        eventRe.lastIndex = 0;
        while ((match = eventRe.exec(buffer)) !== null) {
          const eventName = match[1].trim();
          const dataStr = match[2].trim();
          consumedRanges.push({ start: match.index, end: match.index + match[0].length });

          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }

          switch (eventName) {
            case 'knowledge_result':
              setProgressSteps(prev => {
                if (prev.some(s => s.id === 'knowledge')) return prev;
                return [...prev, { id: 'knowledge', label: '知识库检索', detail: data.summary, type: 'ok' }];
              });
              break;

            case 'intent_result':
              setProgressSteps(prev => {
                const filtered = prev.filter(s => s.id !== 'intent');
                return [...filtered, { id: 'intent', label: '意图分析', detail: data.summary || '', type: 'ok' }];
              });
              break;

            case 'status':
              setProgressSteps(prev => {
                const phaseLabel = data.phase === 'text' ? '文案生成'
                  : data.phase === 'prompt' ? '提示词生成' : '处理中';
                const filtered = prev.filter(s => s.id !== 'status-phase');
                return [...filtered, { id: 'status-phase', label: phaseLabel, detail: data.message || '', type: 'loading' }];
              });
              break;

            case 'text_result':
              setLiveText(data.content || '');
              setProgressSteps(prev => {
                const filtered = prev.filter(s => s.id !== 'text');
                return [...filtered, { id: 'text', label: '文案生成', detail: '文案已生成', type: 'ok' }];
              });
              break;

            case 'prompt_result':
              setProgressSteps(prev => {
                const filtered = prev.filter(s => s.id !== 'prompt');
                return [...filtered, { id: 'prompt', label: '提示词生成', detail: `${(data.prompts || []).length} 个提示词已就绪`, type: 'ok' }];
              });
              break;

            case 'image_progress': {
              const imgStatus = data.status;
              if (imgStatus === 'generating') {
                setProgressSteps(prev => {
                  const filtered = prev.filter(s => s.id !== 'image-gen');
                  return [...filtered, {
                    id: 'image-gen', label: `图片生成 (${data.index}/${data.total})`,
                    detail: '正在生成...', type: 'loading',
                  }];
                });
              } else if (imgStatus === 'done' && data.imageUrl) {
                setLiveImages(prev => [...prev, {
                  url: data.imageUrl, prompt: data.prompt,
                  index: data.index, total: data.total,
                }]);
                setProgressSteps(prev => {
                  const filtered = prev.filter(s => s.id !== 'image-gen');
                  return [...filtered, {
                    id: 'image-gen',
                    label: `图片生成 (${data.index}/${data.total})`,
                    detail: `已完成 ${data.index}/${data.total} 张`,
                    type: data.index === data.total ? 'ok' : 'loading',
                  }];
                });
              } else if (imgStatus === 'error') {
                setProgressSteps(prev => {
                  const filtered = prev.filter(s => s.id !== 'image-gen');
                  return [...filtered, {
                    id: `img-err-${data.index}`,
                    label: `图片 ${data.index}`,
                    detail: `生成失败: ${data.error}`,
                    type: 'error',
                  }];
                });
              }
              break;
            }

            case 'done': {
              const allImages = data.images || [];
              const assistantMsg = {
                id: 'msg-assistant-' + Date.now(),
                role: 'assistant',
                content: data.content || '',
                attachments: allImages
                  .filter(img => img.url || img.imageUrl)
                  .map((img, i) => ({
                    type: 'image',
                    url: img.url || img.imageUrl,
                    prompt: img.prompt || '',
                    index: i + 1,
                  })),
              };

              setMessages(prev => {
                const filtered = prev.filter(m => !m.id.startsWith('temp-'));
                return [...filtered, assistantMsg];
              });

              const finalConvId = data.conversationId || convId;
              if (finalConvId && finalConvId !== currentConversation?.id) {
                loadConversation(finalConvId);
              }
              fetchConversations();

              setProgressSteps([]);
              setLiveImages([]);
              setLiveText('');
              setStatus('idle');
              break;
            }

            case 'error':
              throw new Error(data.message || '处理过程中出错');
          }
        }

        // 截断已消费的 buffer
        if (consumedRanges.length > 0) {
          const last = consumedRanges[consumedRanges.length - 1];
          buffer = buffer.slice(last.end);
        }
      }
    } catch (err) {
      console.error('[AI-Dialog] SSE error:', err);
      setError(err.message);
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
      setProgressSteps([]);
      setLiveImages([]);
      setLiveText('');
      setStatus('idle');
    } finally {
      inputRef.current?.focus();
    }
  }

  function handleNewConversation() {
    setCurrentConversation(null);
    setMessages([]);
    setError(null);
  }

  async function handleDeleteConversation(id, e) {
    e.stopPropagation();
    if (!confirm('确定删除这个对话？')) return;
    try {
      await fetch(`/api/ai-dialog/conversations/${id}`, { method: 'DELETE' });
      if (currentConversation?.id === id) handleNewConversation();
      fetchConversations();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  return (
    <div className="aidp-root">
      <div className="aidp-header">
        <div className="aidp-header-left">
          <button className="aidp-icon-btn" onClick={onBack} title="返回">
            <M.ChevronLeft size={18} />
          </button>
          <span className="aidp-title">AI 智能助手</span>
          {currentConversation && (
            <span className="aidp-conv-name">{currentConversation.title}</span>
          )}
        </div>
        <div className="aidp-header-right">
          <button
            className="aidp-icon-btn"
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? '收起历史' : '展开历史'}
          >
            {sidebarOpen ? <M.ChevronLeft size={18} /> : <M.List size={18} />}
          </button>
          <button className="aidp-new-btn" onClick={handleNewConversation}>
            <M.Plus size={15} />
            新对话
          </button>
        </div>
      </div>

      <div className="aidp-body">
        <div className={`aidp-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="aidp-sidebar-inner">
            <div className="aidp-sidebar-label">历史对话</div>
            <div className="aidp-sidebar-list">
              {conversations.length === 0 && (
                <div className="aidp-sidebar-empty">暂无对话记录</div>
              )}
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`aidp-history-item${currentConversation?.id === conv.id ? ' active' : ''}`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <div className="aidp-history-title">{conv.title}</div>
                  <button
                    className="aidp-history-del"
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    title="删除"
                  >
                    <M.Trash size={12} />
                  </button>
                  <div className="aidp-history-time">{formatTime(conv.updated_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="aidp-chat">
          <div className="aidp-messages">
            {messages.length === 0 && (
              <div className="aidp-empty">
                <div className="aidp-empty-icon"><M.MessageSquare size={40} /></div>
                <div className="aidp-empty-title">有什么可以帮您的？</div>
                <div className="aidp-empty-sub">
                  输入需求，AI 将自动调度知识库和生图能力为您完成任务
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {status === 'loading' && (
              <div className="aidp-msg-row aidp-msg-row--assistant">
                <div className="aidp-msg-bubble aidp-msg-bubble--assistant aidp-live-bubble">
                  {progressSteps.length > 0 && (
                    <div className="aidp-progress-steps">
                      {progressSteps.map((step) => (
                        <div key={step.id} className={`aidp-step aidp-step--${step.type}`}>
                          <span className="aidp-step-icon">
                            {step.type === 'ok' ? '\u2713' : step.type === 'error' ? '\u2717' : '\u22ef'}
                          </span>
                          <span className="aidp-step-label">{step.label}</span>
                          {step.detail && <span className="aidp-step-detail">{step.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {liveText && (
                    <div className="aidp-live-text">
                      <div className="aidp-live-text-label">文案预览</div>
                      <div className="aidp-live-text-content">{liveText}</div>
                    </div>
                  )}

                  {liveImages.length > 0 && (
                    <div className="aidp-live-images">
                      <div className="aidp-live-images-label">生成中图片</div>
                      <div className="aidp-msg-images">
                        {liveImages.map((img, i) => (
                          <div key={i} className="aidp-img-wrap">
                            <img src={img.url} alt={`图片${img.index}`} className="aidp-img" />
                            {img.prompt && <div className="aidp-img-overlay">{img.prompt.slice(0, 60)}...</div>}
                            <div className="aidp-img-badge">{img.index}/{img.total}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {progressSteps.length === 0 && !liveText && liveImages.length === 0 && (
                    <div className="aidp-loading-inline">
                      <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      <span>任务进行中，请稍候...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="aidp-error">
                <M.AlertTriangle size={14} />
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="aidp-input-area">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述您的需求，如：帮我生成一段英文博客文章，同时要3张配图"
              disabled={status === 'loading'}
              rows={1}
              className="aidp-textarea"
            />
            <button
              className="aidp-send-btn"
              onClick={handleSend}
              disabled={status === 'loading' || !input.trim()}
            >
              <M.Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="aidp-msg-row aidp-msg-row--user">
        <div className="aidp-msg-bubble aidp-msg-bubble--user">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="aidp-msg-row aidp-msg-row--assistant">
      <div className="aidp-msg-bubble aidp-msg-bubble--assistant">
        <div className="aidp-msg-text">{message.content}</div>
        {(message.attachments && message.attachments.length > 0) ? (
          <div className="aidp-msg-images">
            {message.attachments.map((att, i) =>
              att.url ? (
                <div key={i} className="aidp-img-wrap">
                  <img
                    src={att.url}
                    alt={att.prompt || `图片${i + 1}`}
                    className="aidp-img"
                    onClick={() => window.open(att.url, '_blank')}
                  />
                  {att.prompt ? (
                    <div className="aidp-img-overlay">{att.prompt}</div>
                  ) : null}
                </div>
              ) : null
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
