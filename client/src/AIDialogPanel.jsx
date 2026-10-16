import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from './components/Icons';
import './AIDialogPanel.css';

const RUNNING = new Set(['queued', 'running']);
const ROLES = { product: '产品图', logo: 'Logo', style: '风格参考', brand: '品牌规范', document: '资料', general: '参考图', edit: '修改底图' };
function pendingRequest() { try { return JSON.parse(sessionStorage.getItem('ai-dialog-pending') || 'null'); } catch { return null; } }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/ai-dialog${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || '请求失败');
  return result.data;
}

export default function AIDialogPanel({ onBack }) {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760);
  const [run, setRun] = useState(null);
  const [options, setOptions] = useState({ models: [], styles: [] });
  const [model, setModel] = useState('auto');
  const [styleId, setStyleId] = useState('auto');
  const [cancelling, setCancelling] = useState(false);
  const loadVersion = useRef(0), endRef = useRef(null), inputRef = useRef(null);
  const pendingRef = useRef(pendingRequest());
  const busy = submitting || RUNNING.has(run?.status);
  const fetchList = useCallback(async () => { const data = await api('/conversations'); setConversations(data); return data; }, []);
  const loadConversation = useCallback(async id => {
    const version = ++loadVersion.current;
    try {
      const data = await api(`/conversations/${id}`);
      if (version !== loadVersion.current) return;
      setConversation(data.conversation); setMessages(data.messages); setRun(data.latestRun); setError('');
      localStorage.setItem('ai-dialog-selected', id);
      window.history.replaceState({}, '', `/ai-dialog/${id}`);
    } catch (failure) { if (version === loadVersion.current) setError(failure.message); }
  }, []);
  useEffect(() => {
    let live = true;
    fetchList().then(async list => {
      const pending = pendingRef.current;
      if (pending && live) {
        try {
          const recovered = await api(`/requests/${pending.requestId}`);
          if (live) { pendingRef.current = null; sessionStorage.removeItem('ai-dialog-pending'); await loadConversation(recovered.conversation_id); }
        } catch {
          if (live) { setInput(pending.message); setModel(pending.options.model); setStyleId(pending.options.styleId); setError('上一条需求的状态未确认，再次发送会复用同一请求标识。'); }
        }
        return;
      }
      const linked = window.location.pathname.split('/')[2];
      const saved = linked || localStorage.getItem('ai-dialog-selected');
      if (live && (linked || list.some(item => item.id === saved))) loadConversation(saved);
    }).catch(failure => { if (live) setError(failure.message); });
    api('/options').then(data => { if (live) setOptions(data); }).catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; loadVersion.current = -1; };
  }, [fetchList, loadConversation]);
  const runId = run?.id, isRunning = RUNNING.has(run?.status);
  useEffect(() => {
    if (!runId || !isRunning) return;
    let live = true, timer;
    const version = loadVersion.current;
    const poll = async () => {
      try {
        const next = await api(`/runs/${runId}`);
        if (!live || version !== loadVersion.current) return;
        setRun(next);
        if (!RUNNING.has(next.status)) {
          await loadConversation(next.conversation_id);
          await fetchList();
          setCancelling(false);
        } else timer = setTimeout(poll, 2000);
      } catch (failure) { if (live) { setError(failure.message); timer = setTimeout(poll, 5000); } }
    };
    timer = setTimeout(poll, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [runId, isRunning, loadConversation, fetchList]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, run?.events?.length]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const changed = event => { if (event.matches) setSidebarOpen(false); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setSubmitting(true); setError('');
    try {
      const existing = pendingRef.current;
      const same = existing && existing.message === message && existing.conversationId === conversation?.id && existing.options.model === model && existing.options.styleId === styleId;
      if (existing && !same) throw new Error('上一条需求的状态尚未确认，请先重新发送原需求，或新建对话。');
      const payload = same ? existing : { conversationId: conversation?.id, message, requestId: crypto.randomUUID(), options: { model, styleId } };
      pendingRef.current = payload; sessionStorage.setItem('ai-dialog-pending', JSON.stringify(payload));
      const started = await api('/runs', 'POST', payload);
      pendingRef.current = null; sessionStorage.removeItem('ai-dialog-pending');
      setInput('');
      setRun(started);
      if (!conversation) {
        const data = await api(`/conversations/${started.conversation_id}`);
        setConversation(data.conversation); setMessages(data.messages); localStorage.setItem('ai-dialog-selected', started.conversation_id); window.history.replaceState({}, '', `/ai-dialog/${started.conversation_id}`);
      } else setMessages(prev => [...prev, { id: `pending-${started.id}`, role: 'user', content: message }]);
      fetchList().catch(() => {});
    } catch (failure) { setError(failure.message); }
    finally { setSubmitting(false); }
  }
  function newConversation() {
    loadVersion.current++; pendingRef.current = null; sessionStorage.removeItem('ai-dialog-pending'); setConversation(null); setMessages([]); setRun(null); setError(''); setInput(''); localStorage.removeItem('ai-dialog-selected'); window.history.replaceState({}, '', '/ai-dialog'); inputRef.current?.focus();
  }
  async function remove(id, event) {
    event.stopPropagation();
    if (!window.confirm('确定删除这个对话？')) return;
    try { await api(`/conversations/${id}`, 'DELETE'); if (conversation?.id === id) newConversation(); await fetchList(); }
    catch (failure) { setError(failure.message); }
  }
  async function cancel() {
    if (!run || cancelling) return;
    setCancelling(true);
    try { await api(`/runs/${run.id}/cancel`, 'POST'); }
    catch (failure) { setError(failure.message); setCancelling(false); }
  }
  const resultVisible = run?.result?.messageId && messages.some(message => message.id === run.result.messageId);
  const failedRun = run && ['failed', 'interrupted', 'cancelled'].includes(run.status);
  return <div className="aidp-root">
    <header className="aidp-header">
      <div className="aidp-header-left"><button className="aidp-icon-btn" onClick={onBack} title="返回" aria-label="返回"><Icon.ChevronLeft size={18} /></button><span className="aidp-title">AI 智能助手</span><span className="aidp-conv-name">{conversation?.title || ''}</span></div>
      <div className="aidp-header-right"><button className="aidp-icon-btn" onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? '收起历史' : '展开历史'} aria-label="切换对话历史"><Icon.List size={18} /></button><button className="aidp-new-btn" onClick={newConversation} disabled={submitting}><Icon.Plus size={15} />新对话</button></div>
    </header>
    <div className="aidp-body">
      <aside className={`aidp-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="aidp-sidebar-inner"><div className="aidp-sidebar-label">历史对话</div><div className="aidp-sidebar-list">{!conversations.length && <div className="aidp-sidebar-empty">暂无对话记录</div>}{conversations.map(item => <div key={item.id} className={`aidp-history-item${conversation?.id === item.id ? ' active' : ''}`}><button className="aidp-history-open" onClick={() => { loadConversation(item.id); if (window.innerWidth < 760) setSidebarOpen(false); }}><span className="aidp-history-title">{item.title}</span><span className="aidp-history-time">{new Date(item.updated_at).toLocaleDateString('zh-CN')}</span></button><button className="aidp-history-del" onClick={event => remove(item.id, event)} title="删除对话" aria-label={`删除 ${item.title}`}><Icon.Trash size={12} /></button></div>)}</div></div>
      </aside>
      {sidebarOpen && <button className="aidp-history-backdrop" aria-label="关闭对话历史" onClick={() => setSidebarOpen(false)} />}
      <main className="aidp-chat">
        <div className="aidp-messages">
          {!messages.length && !busy && <div className="aidp-empty"><div className="aidp-empty-icon"><Icon.MessageSquare size={40} /></div><div className="aidp-empty-title">今天想创作什么？</div></div>}
          {messages.map(item => <MessageBubble key={item.id} message={item} />)}
          {(busy || failedRun) && <section className="aidp-task" aria-label="任务进度" aria-live="polite">
            <div className="aidp-task-heading"><Icon.Brain size={17} /><strong>{failedRun ? run.status === 'interrupted' ? '任务已中断' : run.status === 'cancelled' ? '任务已停止' : '任务未完成' : '正在执行'}</strong><span>{run?.state?.plan?.model || ''}</span></div>
            <RunProgress events={run?.events || []} />
            {run?.state?.partialText && <div className="aidp-live-text-content">{run.state.partialText}</div>}
            {!!run?.state?.images?.length && <ImageResults images={run.state.images.map(img => ({ url: img.imageUrl, prompt: img.prompt }))} aspectRatio={run.state.plan?.imageAspectRatio} />}
            {run?.error && <p className="aidp-task-warning">{run.error}</p>}
            {run?.state?.sources && <Evidence metadata={{ plan: run.state.plan, sources: run.state.sources }} />}
          </section>}
          {!busy && !failedRun && run?.result && !resultVisible && <MessageBubble message={{ content: run.result.content, metadata: run.result, attachments: run.result.images.map(img => ({ url: img.imageUrl, prompt: img.prompt })) }} />}
          {error && <div className="aidp-error" role="alert"><Icon.AlertTriangle size={14} />{error}</div>}
          <div ref={endRef} />
        </div>
        <div className="aidp-composer">
          <div className="aidp-task-options"><label>生图模型<select aria-label="生图模型" value={model} disabled={busy} onChange={event => setModel(event.target.value)}><option value="auto">自动选择</option>{options.models.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>品牌风格<select aria-label="品牌风格" value={styleId} disabled={busy} onChange={event => setStyleId(event.target.value)}><option value="auto">自动匹配 / 默认风格</option>{options.styles.map(item => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' · 默认' : ''}</option>)}</select></label></div>
          <div className="aidp-input-area"><textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder="描述需求、产品型号、用途和风格…" disabled={busy} maxLength={10000} rows={2} className="aidp-textarea" />{busy ? <button className="aidp-send-btn aidp-stop" onClick={cancel} disabled={!run || cancelling} title="停止任务" aria-label="停止任务"><Icon.X size={18} /></button> : <button className="aidp-send-btn" onClick={send} disabled={!input.trim()} title="发送需求" aria-label="发送需求"><Icon.Send size={17} /></button>}</div>
        </div>
      </main>
    </div>
  </div>;
}

function RunProgress({ events }) {
  const steps = [];
  for (const event of events) {
    const data = event.data;
    const label = event.event === 'intent_result' ? data.summary : event.event === 'knowledge_result' ? data.summary : event.event === 'status' ? data.message : event.event === 'image_progress' ? `图片 ${data.index}/${data.total} · ${data.status === 'done' ? '已完成' : data.status === 'error' ? data.error : '生成中'}` : '';
    if (label) steps.push({ seq: event.seq, label, error: data.status === 'error' });
  }
  return <ol className="aidp-run-steps">{steps.slice(-6).map(step => <li key={step.seq} className={step.error ? 'has-error' : ''}>{step.label}</li>)}</ol>;
}

function ImageResults({ images, aspectRatio }) {
  return <div className="aidp-msg-images">{images.filter(image => image.url).map((image, i) => <a className="aidp-img-wrap" style={{ aspectRatio: (image.aspectRatio || aspectRatio || '1:1').replace(':', ' / ') }} key={i} href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={`创作结果 ${i + 1}`} className="aidp-img" />{image.prompt && <div className="aidp-img-overlay">{image.prompt.slice(0, 160)}</div>}</a>)}</div>;
}

function Evidence({ metadata }) {
  if (!metadata) return null;
  const { plan, sources = [], warnings = [] } = metadata;
  return <div className="aidp-evidence">{plan && <div className="aidp-result-tags">{plan.productName && <span>{plan.productName}</span>}{plan.styleName && <span><Icon.Palette size={12} />{plan.styleName}</span>}{plan.model && <span>{plan.model}</span>}</div>}{warnings.map((warning, index) => <p className="aidp-task-warning" key={index}>{warning}</p>)}{!!sources.length && <details><summary><Icon.Book size={14} />参考物料 · {new Set(sources.map(source => source.id)).size}</summary><div className="aidp-sources">{sources.map((source, index) => <div className="aidp-source" key={`${source.id}-${index}`}>{source.url && <img src={source.url} alt={source.title || '参考物料'} />}<div><strong>{source.title}</strong><small>{ROLES[source.role] || '资料'}{source.version ? ` · ${source.version}` : ''}{source.start !== undefined ? ` · 字符 ${source.start + 1}–${source.end}` : ''}</small>{(source.excerpt || source.description) && <p>{source.excerpt || source.description}</p>}</div></div>)}</div></details>}</div>;
}

function MessageBubble({ message }) {
  const user = message.role === 'user';
  return <div className={`aidp-msg-row aidp-msg-row--${user ? 'user' : 'assistant'}`}><div className={`aidp-msg-bubble aidp-msg-bubble--${user ? 'user' : 'assistant'}`}><div className="aidp-msg-text">{message.content}</div>{!user && <><ImageResults images={message.attachments || []} aspectRatio={message.metadata?.plan?.imageAspectRatio} /><Evidence metadata={message.metadata} /></>}</div></div>;
}
