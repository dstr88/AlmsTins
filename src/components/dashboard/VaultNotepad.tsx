import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, Circle, Trash2 } from 'lucide-react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getVaultNotepad } from '@/i18n/components/vaultNotepad';

console.log('[island.mount]', 'VaultNotepad');

type Note = {
	id: string;
	body: string;
	createdAt: string;
	resolvedAt: string | null;
};

type FetchState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; notes: Note[] };

function formatDate(iso: string, lang: string): string {
	const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
	const locale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
	return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function VaultNotepad() {
	const [state, setState] = useState<FetchState>({ status: 'loading' });
	const [input, setInput] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showResolved, setShowResolved] = useState(false);
	const [charCount, setCharCount] = useState(0);
	const [fontSize, setFontSize] = useState(14);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const lang = getClientLang();
	const t = getVaultNotepad(lang);

	useEffect(() => {
		const stored = localStorage.getItem('vn_font_size');
		if (stored) setFontSize(Math.min(22, Math.max(11, Number(stored))));
		load();
	}, []);

	const adjustFont = useCallback((delta: number) => {
		setFontSize((prev) => {
			const next = Math.min(22, Math.max(11, prev + delta));
			localStorage.setItem('vn_font_size', String(next));
			return next;
		});
	}, []);

	async function load() {
		try {
			const res = await fetch('/api/vault/notes');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json() as { ok: boolean; notes: Note[] };
			setState({ status: 'ready', notes: data.notes });
		} catch (err) {
			setState({ status: 'error', message: t.loadError });
		}
	}

	async function addNote(e: React.FormEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text || submitting) return;
		setSubmitting(true);
		try {
			const res = await fetch('/api/vault/notes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: text }),
			});
			if (!res.ok) throw new Error();
			const data = await res.json() as { ok: boolean; note: Note };
			setState((prev) =>
				prev.status === 'ready'
					? { status: 'ready', notes: [data.note, ...prev.notes] }
					: prev,
			);
			setInput('');
			setCharCount(0);
		} catch {
			// leave input intact so user can retry
		} finally {
			setSubmitting(false);
		}
	}

	async function toggleResolved(note: Note) {
		const wasResolved = !!note.resolvedAt;
		// Optimistic update
		setState((prev) => {
			if (prev.status !== 'ready') return prev;
			return {
				status: 'ready',
				notes: prev.notes.map((n) =>
					n.id === note.id
						? { ...n, resolvedAt: wasResolved ? null : new Date().toISOString() }
						: n,
				),
			};
		});
		try {
			await fetch(`/api/vault/notes/${note.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ resolved: !wasResolved }),
			});
		} catch {
			// revert on failure
			setState((prev) => {
				if (prev.status !== 'ready') return prev;
				return {
					status: 'ready',
					notes: prev.notes.map((n) =>
						n.id === note.id ? { ...n, resolvedAt: note.resolvedAt } : n,
					),
				};
			});
		}
	}

	async function deleteNote(id: string) {
		// Optimistic update
		setState((prev) =>
			prev.status === 'ready'
				? { status: 'ready', notes: prev.notes.filter((n) => n.id !== id) }
				: prev,
		);
		try {
			await fetch(`/api/vault/notes/${id}`, { method: 'DELETE' });
		} catch {
			// best-effort; reload to resync
			load();
		}
	}

	const notes = state.status === 'ready' ? state.notes : [];
	const open = notes.filter((n) => !n.resolvedAt);
	const resolved = notes.filter((n) => !!n.resolvedAt);

	return (
		<div className="vn-root">
			{/* Input form */}
			<form className="vn-form" onSubmit={addNote}>
				<textarea
					ref={textareaRef}
					className="vn-input"
					value={input}
					maxLength={500}
					rows={2}
					placeholder={t.inputPlaceholder}
					style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
					onChange={(e) => {
						setInput(e.target.value);
						setCharCount(e.target.value.length);
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							addNote(e as unknown as React.FormEvent);
						}
					}}
				/>
				<div className="vn-form-footer">
					<span className="vn-char-count">{charCount}/500</span>
					<div className="vn-font-controls">
						<button type="button" className="vn-font-btn" onClick={() => adjustFont(-1)} aria-label={t.decreaseFontSize} disabled={fontSize <= 11}>−</button>
						<span className="vn-font-size">{fontSize}</span>
						<button type="button" className="vn-font-btn" onClick={() => adjustFont(1)} aria-label={t.increaseFontSize} disabled={fontSize >= 22}>+</button>
					</div>
					<button
						type="submit"
						className="vn-add-btn"
						disabled={submitting || !input.trim()}
					>
						{submitting ? t.saving : t.addNote}
					</button>
				</div>
			</form>

			{/* Note list */}
			{state.status === 'loading' && (
				<p className="vn-status">{t.loading}</p>
			)}
			{state.status === 'error' && (
				<p className="vn-status vn-status--error">{state.message}</p>
			)}

			{state.status === 'ready' && (
				<div className="vn-list">
					{open.length === 0 && resolved.length === 0 && (
						<p className="vn-empty">{t.empty}</p>
					)}

					{open.map((note) => (
						<NoteRow key={note.id} note={note} fontSize={fontSize} lang={lang} t={t} onToggle={toggleResolved} onDelete={deleteNote} />
					))}

					{resolved.length > 0 && (
						<>
							<button
								type="button"
								className="vn-resolved-toggle"
								onClick={() => setShowResolved((v) => !v)}
							>
								{showResolved ? '▾' : '▸'} {t.resolvedToggle(resolved.length)}
							</button>
							{showResolved && resolved.map((note) => (
								<NoteRow key={note.id} note={note} fontSize={fontSize} lang={lang} t={t} onToggle={toggleResolved} onDelete={deleteNote} dimmed />
							))}
						</>
					)}
				</div>
			)}

			<style>{`
				.vn-root {
					display: flex;
					flex-direction: column;
					gap: 0.75rem;
					height: 100%;
				}

				.vn-form {
					display: flex;
					flex-direction: column;
					gap: 0.35rem;
				}

				.vn-input {
					width: 100%;
					box-sizing: border-box;
					background: var(--surface-card-2);
					border: 1px solid var(--border-bright);
					border-radius: 8px;
					color: var(--text-primary);
					font-family: inherit;
					padding: 0.6rem 0.75rem;
					resize: none;
					outline: none;
					transition: border-color 0.15s;
				}
				.vn-input:focus {
					border-color: var(--accent);
					box-shadow: 0 0 0 2px var(--accent-glow);
				}
				.vn-input::placeholder {
					color: var(--text-muted);
					font-size: 0.8rem;
				}

				.vn-form-footer {
					display: flex;
					justify-content: space-between;
					align-items: center;
					gap: 0.5rem;
				}

				.vn-font-controls {
					display: flex;
					align-items: center;
					gap: 0.2rem;
					margin-left: auto;
				}

				.vn-font-btn {
					background: var(--surface-card-2);
					border: 1px solid var(--border-bright);
					color: var(--text-secondary);
					border-radius: 4px;
					width: 22px;
					height: 22px;
					font-size: 1rem;
					line-height: 1;
					cursor: pointer;
					display: inline-flex;
					align-items: center;
					justify-content: center;
					font-family: inherit;
					transition: background 0.12s, color 0.12s;
				}
				.vn-font-btn:hover:not(:disabled) {
					background: var(--surface-hover);
					color: var(--text-primary);
				}
				.vn-font-btn:disabled {
					opacity: 0.3;
					cursor: not-allowed;
				}

				.vn-font-size {
					font-size: 0.72rem;
					color: var(--text-muted);
					min-width: 18px;
					text-align: center;
				}

				.vn-char-count {
					font-size: 0.72rem;
					color: var(--text-muted);
				}

				.vn-add-btn {
					background: var(--accent);
					color: var(--surface-bg);
					border: none;
					border-radius: 6px;
					padding: 0.35rem 0.85rem;
					font-size: 0.8rem;
					font-weight: 700;
					font-family: inherit;
					cursor: pointer;
					transition: opacity 0.15s;
				}
				.vn-add-btn:disabled {
					opacity: 0.4;
					cursor: not-allowed;
				}
				.vn-add-btn:not(:disabled):hover {
					opacity: 0.85;
				}

				.vn-list {
					display: flex;
					flex-direction: column;
					gap: 0;
					overflow-y: auto;
					flex: 1 1 auto;
					min-height: 0;
					padding-right: 0.1rem;
				}

				.vn-status {
					font-size: 0.85rem;
					color: var(--text-muted);
				}
				.vn-status--error {
					color: var(--loss);
				}

				.vn-empty {
					font-size: 0.8rem;
					color: var(--text-muted);
					text-align: center;
					margin-top: 0.5rem;
					line-height: 1.5;
				}

				.vn-resolved-toggle {
					background: none;
					border: none;
					color: var(--text-muted);
					font-size: 0.78rem;
					font-family: inherit;
					cursor: pointer;
					padding: 0.2rem 0;
					text-align: left;
					transition: color 0.15s;
				}
				.vn-resolved-toggle:hover {
					color: var(--text-secondary);
				}

				/* NoteRow */
				.vn-note {
					display: flex;
					align-items: flex-start;
					gap: 0.5rem;
					background: transparent;
					border: none;
					border-bottom: 1px solid var(--border-subtle);
					border-radius: 0;
					padding: 0.6rem 0.25rem;
					transition: opacity 0.2s;
				}
				.vn-note:last-child {
					border-bottom: none;
				}
				.vn-note--dimmed {
					opacity: 0.45;
				}
				.vn-note-check {
					background: none;
					border: none;
					padding: 0;
					cursor: pointer;
					color: var(--text-muted);
					flex-shrink: 0;
					margin-top: 0.1rem;
					transition: color 0.15s;
					line-height: 0;
				}
				.vn-note-check:hover {
					color: var(--accent);
				}
				.vn-note-check--done {
					color: var(--gain);
				}
				.vn-note-check--done:hover {
					color: var(--gain);
					opacity: 0.7;
				}
				.vn-note-body {
					flex: 1 1 auto;
					min-width: 0;
				}
				.vn-note-text {
					color: var(--text-primary);
					white-space: pre-wrap;
					word-break: break-word;
				}
				.vn-note--dimmed .vn-note-text {
					text-decoration: line-through;
					color: var(--text-muted);
				}
				.vn-note-date {
					font-size: 0.72rem;
					color: var(--text-muted);
					margin-top: 0.2rem;
				}
				.vn-note-delete {
					background: none;
					border: none;
					padding: 0;
					cursor: pointer;
					color: var(--text-muted);
					flex-shrink: 0;
					margin-top: 0.1rem;
					opacity: 0;
					transition: opacity 0.15s, color 0.15s;
					line-height: 0;
				}
				.vn-note:hover .vn-note-delete {
					opacity: 1;
				}
				.vn-note-delete:hover {
					color: var(--loss);
				}
			`}</style>
		</div>
	);
}

function NoteRow({
	note,
	fontSize,
	lang,
	t,
	onToggle,
	onDelete,
	dimmed = false,
}: {
	note: Note;
	fontSize: number;
	lang: string;
	t: import('@/i18n/components/vaultNotepad').VaultNotepadLocale;
	onToggle: (note: Note) => void;
	onDelete: (id: string) => void;
	dimmed?: boolean;
}) {
	const isDone = !!note.resolvedAt;
	return (
		<div className={`vn-note${dimmed ? ' vn-note--dimmed' : ''}`}>
			<button
				type="button"
				className={`vn-note-check${isDone ? ' vn-note-check--done' : ''}`}
				onClick={() => onToggle(note)}
				aria-label={isDone ? t.markUnaccounted : t.markAccounted}
				title={isDone ? t.markUnaccounted : t.markAccounted}
			>
				{isDone
					? <CheckCircle2 size={16} strokeWidth={2} />
					: <Circle size={16} strokeWidth={2} />
				}
			</button>
			<div className="vn-note-body">
				<div className="vn-note-text" style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}>{note.body}</div>
				<div className="vn-note-date">{formatDate(note.createdAt, lang)}</div>
			</div>
			<button
				type="button"
				className="vn-note-delete"
				onClick={() => onDelete(note.id)}
				aria-label={t.deleteNote}
				title={t.deleteNote}
			>
				<Trash2 size={14} strokeWidth={2} />
			</button>
		</div>
	);
}

export default VaultNotepad;
