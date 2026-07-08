import { useState, useRef, useEffect } from 'react';
import './AiChat.css';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface UsageInfo {
  used: number;
  limit: number | null;
}

export default function AiChat() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [usage, setUsage]     = useState<UsageInfo | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load usage on mount
  useEffect(() => {
    fetch('/api/research/chat')
      .then(r => r.json())
      .then(d => { if (d.ok) setUsage(d.usage); })
      .catch(() => {});
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const atLimit = usage !== null && usage.limit !== null && usage.used >= usage.limit;

  async function send() {
    const q = input.trim();
    if (!q || loading || atLimit) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    try {
      const res = await fetch('/api/research/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();

      if (data.ok) {
        setMessages(prev => [...prev, { role: 'assistant', text: data.answer }]);
        setUsage(data.usage);
      } else if (data.error === 'limit_reached') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: `You've used all ${data.limit} questions for this month. [Upgrade your plan](${data.upgradeUrl}) for more.`,
        }]);
        setUsage({ used: data.used, limit: data.limit });
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: data.error ?? 'Something went wrong. Please try again.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Network error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const usageLabel = usage
    ? usage.limit === null
      ? `${usage.used} questions used`
      : `${usage.used} / ${usage.limit} questions this month`
    : null;

  return (
    <div className="ai-chat">
      <button
        className={`ai-chat__toggle ${open ? 'ai-chat__toggle--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Ask about your portfolio"
      >
        <span className="ai-chat__toggle-icon">{open ? '✕' : '✦'}</span>
        <span className="ai-chat__toggle-label">{open ? 'Close' : 'Ask AI'}</span>
        {!open && usage && usage.limit !== null && (
          <span className={`ai-chat__badge ${atLimit ? 'ai-chat__badge--empty' : ''}`}>
            {usage.limit - usage.used}
          </span>
        )}
      </button>

      {open && (
        <div className="ai-chat__panel">
          <div className="ai-chat__header">
            <span className="ai-chat__header-title">Portfolio Assistant</span>
            {usageLabel && (
              <span className={`ai-chat__usage ${atLimit ? 'ai-chat__usage--empty' : ''}`}>
                {usageLabel}
              </span>
            )}
          </div>

          <div className="ai-chat__messages">
            {messages.length === 0 && (
              <p className="ai-chat__empty">
                Ask about your holdings, transactions, or cost basis.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`ai-chat__msg ai-chat__msg--${m.role}`}>
                <span className="ai-chat__msg-text">{m.text}</span>
              </div>
            ))}
            {loading && (
              <div className="ai-chat__msg ai-chat__msg--assistant">
                <span className="ai-chat__thinking">Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {atLimit ? (
            <div className="ai-chat__limit-banner">
              Monthly limit reached.{' '}
              <a href="/dashboard/billing" className="ai-chat__upgrade-link">Upgrade →</a>
            </div>
          ) : (
            <div className="ai-chat__input-row">
              <textarea
                className="ai-chat__input"
                rows={2}
                placeholder="Ask about your portfolio…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={loading}
              />
              <button
                className="ai-chat__send"
                onClick={send}
                disabled={loading || !input.trim()}
              >
                {loading ? '…' : '→'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
