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
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || status === 'loading') return;
    const userMessage = input.trim();
    setInput('');
    setStatus('loading');
    setError(null);

    const optimisticUserMsg = { id: 'temp-' + Date.now(), role: 'user', content: userMessage, attachments: [] };
    setMessages(prev => [...prev, optimisticUserMsg]);

    try {
      const resp = await fetch('/api/ai-dialog/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversation?.id, message: userMessage }),
      });
      const data = await resp.json();

      if (!data.success) throw new Error(data.message || '处理失败');

      if (data.data.conversationId && !currentConversation) {
        loadConversation(data.data.conversationId);
        fetchConversations();
      } else if (data.data.conversationId) {
        const assistantMsg = {
          id: data.data.messageId,
          role: 'assistant',
          content: data.data.content,
          attachments: data.data.images || [],
        };
        setMessages(prev => [...prev.filter(m => !m.id.startsWith('temp-')), assistantMsg]);
        fetchConversations();
      }
    } catch (err) {
      setError(err.message);
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
    } finally {
      setStatus('idle');
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
      {/* 顶部栏 */}
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

      {/* 主体 */}
      <div className="aidp-body">
        {/* 左侧历史 */}
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

        {/* 右侧聊天 */}
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
              <div className="aidp-loading">
                <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                <span>任务进行中，请稍后...</span>
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

          {/* 输入区 */}
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
