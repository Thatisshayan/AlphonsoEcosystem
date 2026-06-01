import { useEffect, useState } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';

const STORAGE_KEY = 'alphonso_selected_model_v1';
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
const FETCH_TIMEOUT_MS = 3000;

/**
 * ModelSwitcher — compact Ollama model dropdown for the chat header bar.
 *
 * Props:
 *   onModelChange(modelName: string) — called when the user picks a new model.
 *   initialModel(string|undefined) — seed value (e.g. from parent settings).
 */
export function ModelSwitcher({ onModelChange, initialModel }) {
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(
    () => initialModel || localStorage.getItem(STORAGE_KEY) || ''
  );
  const [ollamaOnline, setOllamaOnline] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (cancelled) return;
        const names = Array.isArray(data?.models)
          ? data.models.map((m) => m.name || m.model).filter(Boolean)
          : [];
        setModels(names);
        setOllamaOnline(names.length > 0);

        // If no stored/initial selection, default to the first model
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored && names.length > 0) {
          const first = names[0];
          setSelected(first);
          localStorage.setItem(STORAGE_KEY, first);
          onModelChange?.(first);
        }
      } catch {
        clearTimeout(timer);
        if (!cancelled) {
          setOllamaOnline(false);
          setModels([]);
        }
      }
    }

    void fetchModels();
    return () => { cancelled = true; };
  }, [onModelChange]);

  function handleChange(event) {
    const name = event.target.value;
    setSelected(name);
    localStorage.setItem(STORAGE_KEY, name);
    onModelChange?.(name);
  }

  // Still loading
  if (ollamaOnline === null) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-white/5 rounded-lg text-[10px] text-zinc-500 font-medium uppercase tracking-widest">
        <Cpu className="w-3 h-3 shrink-0" />
        <span>Loading…</span>
      </div>
    );
  }

  // Ollama not running
  if (!ollamaOnline) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-amber-500/20 rounded-lg text-[10px] text-amber-400 font-medium uppercase tracking-widest"
        title="Ollama is not running — start it to switch models"
      >
        <Cpu className="w-3 h-3 shrink-0" />
        <span>Ollama offline</span>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1 bg-zinc-900 border border-white/5 rounded-lg px-2 py-1 hover:border-indigo-500/30 transition-colors">
      <Cpu className="w-3 h-3 text-zinc-500 shrink-0 pointer-events-none" />
      <select
        value={selected}
        onChange={handleChange}
        className="appearance-none bg-transparent text-[10px] text-zinc-300 font-medium uppercase tracking-widest pr-4 focus:outline-none cursor-pointer max-w-[140px] truncate"
        title={selected || 'Select Ollama model'}
      >
        {models.map((name) => (
          <option key={name} value={name} className="bg-zinc-900 text-zinc-200 normal-case tracking-normal">
            {name}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2 pointer-events-none" />
    </div>
  );
}
