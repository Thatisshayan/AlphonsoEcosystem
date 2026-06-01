import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, History, Paperclip, Search, Send, Trash2, X } from 'lucide-react';
import { getStorage, setStorage } from '../lib/appStorage';
import { nextMsgId, CHAT_ASSISTANT_PROMPT, shouldRouteThroughJose } from '../lib/chatUtils';
import { isJoseIntakeCommand, runJoseCommandExecutionPipeline } from '../services/joseExecutionEngineService';
import { deleteChatMessages, loadChatMessages, persistChatMessages } from '../services/chatPersistenceService';
import {
  OLLAMA_TROUBLESHOOTING_COMMAND,
  classifyOllamaError,
  generateOllamaStream
} from '../lib/ollama';
import { ModelSwitcher } from './ModelSwitcher';

const RuntimeNotice = lazy(() => import('./RuntimeNotice').then((mod) => ({ default: mod.RuntimeNotice })));
const MicrophoneStatus = lazy(() => import('./MicrophoneStatus').then((mod) => ({ default: mod.MicrophoneStatus })));
const VoiceInputButton = lazy(() => import('./VoiceInputButton').then((mod) => ({ default: mod.VoiceInputButton })));

export function ChatView({
  activeChatId,
  settings,
  setConversations,
  ollamaStatus,
  installedModels,
  selectedModelMissing,
  voice,
  onGenerationChange,
  onTaskComplete,
  onRetryOllama,
  onJoseExecutionState,
  onOpenSettings,
  onModelChange
}) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileAttach = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 500 * 1024;
    if (file.size > MAX_SIZE) {
      setAttachedFile({ name: file.name, error: 'File too large (max 500 KB)' });
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setAttachedFile({ name: file.name, content });
      setInputValue((current) => current
        ? `${current}\n\n[Attached: ${file.name}]\n\`\`\`\n${content}\n\`\`\``
        : `[Attached: ${file.name}]\n\`\`\`\n${content}\n\`\`\``
      );
    };
    reader.onerror = () => setAttachedFile({ name: file.name, error: 'Failed to read file' });
    reader.readAsText(file);
    event.target.value = '';
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const durable = await loadChatMessages(activeChatId);
      if (cancelled) return;
      if (durable && durable.length > 0) {
        setMessages(durable);
      } else {
        setMessages(getStorage(`alphonso_messages_${activeChatId}`, []));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeChatId]);

  useEffect(() => {
    if (messages.length > 0) {
      setStorage(`alphonso_messages_${activeChatId}`, messages);
      persistChatMessages(activeChatId, messages);
      setConversations((current) => current.map((conversation) =>
        conversation.id === activeChatId &&
        (conversation.title === 'Unsaved Chat' || conversation.title === 'New Chat Session')
          ? { ...conversation, title: `${messages[0].content.slice(0, 30)}...` }
          : conversation
      ));
    }
  }, [messages, activeChatId, setConversations]);

  useEffect(() => {
    if (settings.autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isGenerating, settings.autoScroll]);

  const modelReady = settings.selectedModel && !selectedModelMissing;

  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating) return;
    const cleanInput = inputValue.trim();
    const joseCommand = isJoseIntakeCommand(cleanInput) || shouldRouteThroughJose(cleanInput);

    if (joseCommand) {
      const userMessage = { id: nextMsgId(), role: 'user', content: cleanInput };
      setMessages((current) => [...current, userMessage]);
      setInputValue('');
      setAttachedFile(null);
      setIsGenerating(true);
      onGenerationChange(true);
      onJoseExecutionState?.('thinking', 'Jose is decomposing and distributing the command.');

      try {
        const result = await runJoseCommandExecutionPipeline({
          commandText: cleanInput,
          source: 'shayan',
          endpoint: settings.endpoint,
          zeroCostMode: settings.zeroCostMode
        });

        const command = result?.command || {};
        const shayanReport = command?.shayanReport || null;
        const summary = shayanReport?.summary || 'Jose processed the command.';
        const urlLine = shayanReport?.resultUrl ? `\nVerified URL: ${shayanReport.resultUrl}` : '\nVerified URL: not available yet.';
        const executionLine = `\nExecuted: ${result?.executedCount || 0} | Pending approval: ${result?.pendingApprovalCount || 0} | Failed: ${result?.failedCount || 0}`;
        const commandLine = `\nCommand ID: ${result?.commandId || 'n/a'}`;
        const hintLine = (result?.pendingApprovalCount || 0) > 0
          ? '\nNext step: open Jose workspace and approve high-risk external tasks.'
          : '\nNext step: review Jose receipts in Orchestrator view.';

        setMessages((current) => [...current, {
          id: nextMsgId(),
          role: 'assistant',
          content: `Jose Report\n\n${summary}${urlLine}${executionLine}${commandLine}${hintLine}`
        }]);
        onJoseExecutionState?.(
          (result?.pendingApprovalCount || 0) > 0 ? 'approving' : 'task_complete',
          (result?.pendingApprovalCount || 0) > 0
            ? 'Jose executed safe tasks and is waiting for approvals.'
            : 'Jose completed routing and merged reports.'
        );
        onTaskComplete();
      } catch (error) {
        setMessages((current) => [...current, {
          id: nextMsgId(),
          role: 'assistant',
          isError: true,
          content: `Jose orchestration failed.\n\n${String(error)}`
        }]);
        onJoseExecutionState?.('warning', 'Jose orchestration failed.');
      } finally {
        setIsGenerating(false);
        onGenerationChange(false);
      }
      return;
    }

    if (!modelReady) {
      setMessages((current) => [...current, {
        id: nextMsgId(),
        role: 'assistant',
        isError: true,
        content: selectedModelMissing
          ? `Model not found: ${settings.selectedModel}. Choose one of the installed models: ${installedModels.map((model) => model.name).join(', ')}.`
          : 'No Ollama model is selected. Run Check Ollama and choose an installed model.'
      }]);
      return;
    }

    const userMessage = { id: nextMsgId(), role: 'user', content: cleanInput };
    setMessages((current) => [...current, userMessage]);
    setInputValue('');
    setAttachedFile(null);
    setIsGenerating(true);
    onGenerationChange(true);

    const assistantMsgId = nextMsgId();
    setMessages((current) => [...current, { id: assistantMsgId, role: 'assistant', content: '' }]);

    try {
      await generateOllamaStream({
        endpoint: settings.endpoint,
        model: settings.selectedModel,
        prompt: `${CHAT_ASSISTANT_PROMPT}\n\nUser request:\n${userMessage.content}`,
        onToken: (_tok, full) => {
          setMessages((current) => current.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, content: full } : msg
          ));
        }
      });
      setMessages((current) => current.map((msg) => {
        if (msg.id !== assistantMsgId) return msg;
        return msg.content ? msg : { ...msg, content: 'Ollama returned an empty response.' };
      }));
      onTaskComplete();
    } catch (error) {
      const classified = classifyOllamaError(error);
      setMessages((current) => current.map((msg) =>
        msg.id === assistantMsgId
          ? { ...msg, isError: true, content: `${classified.label}\n\n${classified.message}\n\nPowerShell:\n${OLLAMA_TROUBLESHOOTING_COMMAND}` }
          : msg
      ));
    } finally {
      setIsGenerating(false);
      onGenerationChange(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setAttachedFile(null);
    localStorage.removeItem(`alphonso_messages_${activeChatId}`);
    void deleteChatMessages(activeChatId);
  };

  const exportChat = () => {
    if (messages.length === 0) return;
    const lines = messages.map((m) => {
      const role = m.role === 'user' ? 'You' : 'Alphonso';
      return `### ${role}\n${m.content}`;
    });
    const md = `# Alphonso Chat — ${activeChatId}\n_Exported ${new Date().toLocaleString()}_\n\n---\n\n${lines.join('\n\n---\n\n')}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alphonso-chat-${activeChatId}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.content?.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/[0.03] shrink-0 bg-zinc-950/40">
        <div className="h-12 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] text-zinc-500 font-medium">CHAT SESSION: {activeChatId}</span>
            </div>
            <ModelSwitcher
              initialModel={settings.selectedModel}
              onModelChange={onModelChange}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setSearchOpen((o) => !o); setSearchQuery(''); }}
              className={`text-[10px] flex items-center gap-1.5 transition-colors uppercase tracking-widest font-bold ${searchOpen ? 'text-indigo-400' : 'text-zinc-500 hover:text-indigo-400'}`}
            >
              <Search className="w-3 h-3" />
            </button>
            <button
              onClick={exportChat}
              disabled={messages.length === 0}
              className="text-[10px] text-zinc-500 hover:text-indigo-400 flex items-center gap-1.5 transition-colors uppercase tracking-widest font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Download className="w-3 h-3" /> Export
            </button>
            <button
              onClick={clearChat}
              className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1.5 transition-colors uppercase tracking-widest font-bold"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="flex items-center gap-2 px-6 pb-2">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages…"
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
            />
            {searchQuery && (
              <span className="text-[10px] text-zinc-500">{visibleMessages.length} of {messages.length}</span>
            )}
            <button onClick={() => setSearchQuery('')} className="text-zinc-600 hover:text-zinc-400">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <RuntimeNotice
          ollamaStatus={ollamaStatus}
          selectedModelMissing={selectedModelMissing}
          installedModels={installedModels}
          onRetryOllama={onRetryOllama}
          onOpenSettings={onOpenSettings}
        />
      </Suspense>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50 select-none">
            <Bot className="w-16 h-16 mb-4" />
            <p className="text-sm font-medium">Local chat ready when Ollama is connected</p>
          </div>
        )}

        {searchQuery && visibleMessages.length === 0 && (
          <div className="text-center text-[11px] text-zinc-600 py-8">No messages match "{searchQuery}"</div>
        )}
        {visibleMessages.map((message) => (
          <div key={message.id} className={`flex gap-4 max-w-3xl mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${message.role === 'user' ? 'justify-end' : ''}`}>
            {message.role === 'assistant' && (
              <div className={`w-8 h-8 rounded-lg ${message.isError ? 'bg-red-500/10 border-red-500/20' : 'bg-indigo-500/10 border-indigo-500/20'} border flex items-center justify-center shrink-0 mt-1 shadow-sm`}>
                <Bot className={`w-4 h-4 ${message.isError ? 'text-red-400' : 'text-indigo-400'}`} />
              </div>
            )}
            <div className={`flex flex-col gap-1.5 ${message.role === 'user' ? 'items-end' : 'items-start'} max-w-[90%]`}>
              <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap border shadow-sm ${
                message.role === 'user'
                  ? 'bg-zinc-800 text-zinc-100 border-white/5 rounded-tr-sm'
                  : `bg-zinc-900/30 border-white/[0.05] rounded-tl-sm ${message.isError ? 'text-red-300 border-red-500/20' : 'text-zinc-300'}`
              }`}>
                {message.content}
              </div>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex gap-4 max-w-3xl mx-auto w-full">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 text-indigo-400 animate-pulse" />
            </div>
            <div className="bg-zinc-900/30 border border-white/[0.05] p-3 rounded-2xl rounded-tl-sm flex gap-1">
              <div className="w-1.5 h-1.5 bg-indigo-500/50 rounded-full animate-bounce [animation-duration:0.8s]" />
              <div className="w-1.5 h-1.5 bg-indigo-500/50 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]" />
              <div className="w-1.5 h-1.5 bg-indigo-500/50 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-5 shrink-0 max-w-4xl mx-auto w-full">
        <div className="relative bg-zinc-900/80 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-sm group focus-within:border-indigo-500/50 transition-all">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.js,.jsx,.ts,.tsx,.py,.json,.yaml,.yml,.csv,.html,.css,.rs,.go,.java,.sh,.env.example"
            onChange={handleFileAttach}
            className="hidden"
          />
          <div className="absolute -top-10 left-0 flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border rounded-t-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                attachedFile?.error
                  ? 'border-red-500/30 text-red-400'
                  : attachedFile?.name
                    ? 'border-emerald-500/30 text-emerald-400'
                    : 'border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10'
              }`}
              title="Attach a file to your message"
            >
              <Paperclip className="w-3 h-3" />
              {attachedFile?.error ? attachedFile.error : attachedFile?.name ? attachedFile.name : 'ATTACH FILE'}
            </button>
            <Suspense fallback={null}>
              <VoiceInputButton voiceStatus={voice.voiceStatus} onToggle={voice.toggleListening} />
            </Suspense>
          </div>
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            className="w-full bg-transparent text-zinc-100 p-4 min-h-[100px] focus:outline-none text-[13px] resize-none scroll-m-0"
          />
          <div className="mt-1 text-[10px] text-zinc-500">
            {ollamaStatus.state === 'connected' && !selectedModelMissing
              ? `Message ${settings.selectedModel || 'local model'}`
              : 'Ollama is setup_required. Check runtime, then choose a local model.'}
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={isGenerating || !inputValue.trim()}
              className={`h-9 px-4 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-widest transition-all ${
                isGenerating || !inputValue.trim()
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
                  : 'bg-white text-zinc-950 hover:bg-indigo-400 hover:text-white shadow-lg'
              }`}
            >
              {isGenerating ? 'Computing...' : 'Run Prompt'}
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-3">
          <Suspense fallback={null}>
            <MicrophoneStatus voiceStatus={voice.voiceStatus} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
