import './style.css';
import { AudioRecorder } from './audio-recorder';
import type { RecorderState } from './audio-recorder';
import {
  transcribeAudio,
  generateSuggestions,
  chatAboutMeeting,
  getApiKey,
  setApiKey,
  getModel,
  setModel,
  getWhisperModel,
  setWhisperModel,
} from './groq-api';
import type { ChatMessage } from './groq-api';
import { renderMarkdown } from './markdown';
import { register, login, logout, getCurrentUser, isLoggedIn, getUserData, updateUserPlan } from './auth';
import type { UserPlan } from './auth';

// ===== App State =====
interface TranscriptEntry {
  timestamp: string;
  text: string;
}

interface Suggestion {
  type: 'action' | 'insight' | 'question' | 'summary';
  text: string;
  time: string;
}

interface AppState {
  recorderState: RecorderState;
  transcript: TranscriptEntry[];
  suggestions: Suggestion[];
  chatMessages: { role: 'user' | 'ai'; text: string }[];
  chatHistory: ChatMessage[];
  elapsedSeconds: number;
  isChatOpen: boolean;
  isSettingsOpen: boolean;
  isSuggestionsLoading: boolean;
}

const state: AppState = {
  recorderState: 'idle',
  transcript: [],
  suggestions: [],
  chatMessages: [],
  chatHistory: [],
  elapsedSeconds: 0,
  isChatOpen: true,
  isSettingsOpen: false,
  isSuggestionsLoading: false,
};

let timerInterval: ReturnType<typeof setInterval> | null = null;
let recorder: AudioRecorder;
let suggestionDebounce: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = 'twinmind_session';
let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

function saveState(): void {
  const data = {
    transcript: state.transcript,
    suggestions: state.suggestions,
    chatMessages: state.chatMessages,
    chatHistory: state.chatHistory,
    elapsedSeconds: state.elapsedSeconds,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* quota exceeded — ignore */ }
}

function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.transcript) state.transcript = data.transcript;
    if (data.suggestions) state.suggestions = data.suggestions;
    if (data.chatMessages) state.chatMessages = data.chatMessages;
    if (data.chatHistory) state.chatHistory = data.chatHistory;
    if (typeof data.elapsedSeconds === 'number') state.elapsedSeconds = data.elapsedSeconds;
  } catch (_) { /* corrupted data — ignore */ }
}

// ===== Utility Functions =====
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const container = document.getElementById('toast-container')!;
  const icons: Record<string, string> = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function getFullTranscriptText(): string {
  return state.transcript.map(e => e.text).join(' ');
}

function showConfirm(title: string, message: string, onConfirm: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('confirm-cancel')!.addEventListener('click', () => overlay.remove());
  document.getElementById('confirm-ok')!.addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

function exportTranscript(): void {
  if (state.transcript.length === 0) {
    showToast('No transcript to export', 'error');
    return;
  }
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let md = `# TwinMind Meeting Transcript\n## ${date}\n\n---\n\n`;
  state.transcript.forEach(entry => {
    md += `**[${entry.timestamp}]** ${entry.text}\n\n`;
  });
  if (state.suggestions.length > 0) {
    md += `---\n\n## AI Suggestions\n\n`;
    state.suggestions.forEach(s => {
      const icon = s.type === 'action' ? '⚡' : s.type === 'insight' ? '🔍' : s.type === 'question' ? '❓' : '📄';
      md += `- ${icon} **${s.type.toUpperCase()}**: ${s.text} _(${s.time})_\n`;
    });
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twinmind-transcript-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Transcript exported successfully', 'success');
}

// ===== Render App =====
function renderApp(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header class="app-header">
      <div class="app-logo">
        <img src="/twinmind-logo.png" alt="TwinMind Logo" class="logo-icon" />
        <h1>TwinMind</h1>
        <span class="badge">Live Copilot</span>
      </div>
      <div class="header-info">Real-time Meeting Intelligence</div>
      <div class="header-actions">
        <div class="user-info" style="display: flex; align-items: center; gap: 8px; margin-right: 12px;">
          <span class="user-greeting">Hi, ${getCurrentUser() || 'User'}</span>
        </div>
        <button class="btn btn-ghost" id="btn-export" title="Export Transcript" ${state.transcript.length === 0 ? 'disabled' : ''}>📥 Export</button>
        <button class="btn btn-ghost btn-icon" id="btn-settings" title="Settings">⚙️</button>
        <button class="btn btn-ghost" id="btn-clear" title="Clear Session">🗑️</button>
        <button class="btn btn-danger" id="btn-logout" title="Logout">Logout</button>
      </div>
    </header>


    ${!getApiKey() ? `
      <div class="upgrade-banner" style="background: var(--danger); margin-top: 0;">
        <span>⚠️ Groq API Key is not configured. Please add it in Settings to enable AI features.</span>
        <button class="btn btn-primary btn-sm" id="btn-banner-settings" style="padding: 4px 12px; font-size: 11px; background: white; color: var(--danger);">Open Settings</button>
      </div>
    ` : ''}

    <div class="main-content">
      <!-- Left Column: Transcript -->
      <div class="panel transcript-panel" id="transcript-panel">
        <div class="panel-header">
          <h2><span class="icon">📝</span> Transcript</h2>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div id="transcription-status" style="display: none; align-items: center; gap: 4px; font-size: 10px; color: var(--accent-primary);">
              <div class="spinner-sm"></div> Processing...
            </div>
            <span class="count" id="transcript-count">${state.transcript.length} entries</span>
          </div>
        </div>
        <div class="panel-body" id="transcript-body">
          ${state.transcript.length === 0 ? `
            <div class="transcript-empty">
              <div class="empty-icon">🎙️</div>
              <h3>Ready to listen</h3>
              <p>Your meeting transcript will appear here in real-time once you start recording.</p>
            </div>
          ` : state.transcript.map(e => `
            <div class="transcript-entry">
              <div class="timestamp">${escapeHtml(e.timestamp)}</div>
              <div class="text">${escapeHtml(e.text)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Middle Column: Controls & Suggestions -->
      <div class="panel center-panel">
        <div class="panel-body" style="padding: 0; display: flex; flex-direction: column;">
          
          <div class="sticky-controls">
            <div class="meeting-status">
              <div class="status-badge ${state.recorderState === 'recording' ? 'active' : 'idle'}">
                <span class="dot"></span> ${state.recorderState === 'recording' ? 'Meeting in progress' : 'Ready to record'}
              </div>
              <h2>${state.recorderState === 'recording' ? 'Recording Active' : 'Start Meeting'}</h2>
              <p>${state.recorderState === 'recording' ? 'Capturing audio and generating insights...' : 'Click the microphone to begin your AI-powered session.'}</p>
            </div>

            <div class="record-controls">
              <div class="record-timer" id="record-timer">${formatTime(state.elapsedSeconds)}</div>
              <button class="btn btn-record ${state.recorderState === 'recording' ? 'recording' : ''}" id="btn-record">
                ${state.recorderState === 'recording' ? '⏹' : '🎙'}
              </button>
              
              <div class="visualizer-container" id="visualizer">
                ${Array.from({ length: 32 }, () => '<div class="visualizer-bar"></div>').join('')}
              </div>
            </div>
          </div>

          <div class="scrollable-suggestions" style="flex: 1; overflow-y: auto; padding: 20px;">
            <div class="suggestions-section" style="width: 100%;">
              <div class="panel-header" style="border-top: 1px solid var(--border); background: transparent; padding: 12px 0;">
                <h2><span class="icon">💡</span> Live Suggestions</h2>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <button class="btn btn-ghost btn-icon" id="btn-refresh-suggestions" title="Refresh Suggestions" style="width: 24px; height: 24px; font-size: 12px;">🔄</button>
                  <span class="count" id="suggestion-count">${state.suggestions.length}</span>
                </div>
              </div>
              <div id="suggestions-body" style="min-height: 200px;">
                ${state.isSuggestionsLoading ? `
                  <div class="transcript-empty">
                    <div class="spinner" style="width:24px;height:24px;margin-bottom:12px;border:2px solid var(--border);border-top-color:var(--accent-primary);border-radius:50%;animation:spin 1s linear infinite;"></div>
                    <p>Analyzing context...</p>
                  </div>
                ` : state.suggestions.length === 0 ? `
                  <div class="transcript-empty" style="padding: 20px;">
                    <p style="font-size: 13px;">Suggestions will appear here automatically.</p>
                  </div>
                ` : state.suggestions.map(s => `
                  <div class="suggestion-card" data-suggestion="${escapeHtml(s.text)}">
                    <div class="suggestion-type ${escapeHtml(s.type)}">
                      ${s.type === 'action' ? '⚡ Action' : s.type === 'insight' ? '🔍 Insight' : s.type === 'question' ? '❓ Question' : '📄 Summary'}
                    </div>
                    <div class="suggestion-text">${escapeHtml(s.text)}</div>
                    <div class="suggestion-time">${escapeHtml(s.time)}</div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="quick-actions" style="margin-top: 24px;">
              <button class="btn btn-ghost" id="btn-summarize" ${state.transcript.length === 0 ? 'disabled' : ''}>📋 Summarize</button>
              <button class="btn btn-ghost" id="btn-action-items" ${state.transcript.length === 0 ? 'disabled' : ''}>✅ Actions</button>
              <button class="btn btn-ghost" id="btn-key-decisions" ${state.transcript.length === 0 ? 'disabled' : ''}>🔑 Decisions</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Chat -->
      <div class="panel chat-panel" id="chat-panel">
        <div class="panel-header">
          <h2><span class="icon">💬</span> AI Chat</h2>
          <span class="count">Session Only</span>
        </div>
        <div class="panel-body chat-messages" id="chat-messages">
          ${state.chatMessages.length === 0 ? `
            <div class="transcript-empty">
              <div class="empty-icon">🤖</div>
              <h3>TwinMind Assistant</h3>
              <p>Ask me anything about your meeting. I can help with details, clarifications, or deeper analysis.</p>
            </div>
          ` : state.chatMessages.map(m => `
            <div class="chat-message ${m.role}">
              <div class="avatar">${m.role === 'user' ? 'ME' : 'TM'}</div>
              <div class="content">${m.role === 'ai' ? renderMarkdown(m.text) : escapeHtml(m.text)}</div>
            </div>
          `).join('')}
        </div>
        <div class="chat-input-container">
          <input type="text" class="chat-input" id="chat-input" placeholder="Ask TwinMind..." />
          <button class="btn btn-primary" id="btn-chat-send">Send</button>
        </div>
      </div>
    </div>
    
    <div class="toast-container" id="toast-container"></div>
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      .spinner-sm { width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite; }
      .chat-messages { display: flex; flex-direction: column; }
    </style>
  `;
  attachEventListeners();
}

// ===== Event Listeners =====
function attachEventListeners(): void {
  document.getElementById('btn-record')!.addEventListener('click', toggleRecording);
  document.getElementById('btn-settings')!.addEventListener('click', openSettings);
  document.getElementById('btn-clear')!.addEventListener('click', () => {
    if (state.transcript.length === 0 && state.chatMessages.length === 0) {
      clearSession();
    } else {
      showConfirm('Clear Session?', 'This will erase all transcript data, suggestions, and chat history. This cannot be undone.', clearSession);
    }
  });
  document.getElementById('btn-export')!.addEventListener('click', exportTranscript);
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  document.getElementById('btn-chat-send')!.addEventListener('click', sendChatMessage);
  document.getElementById('chat-input')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') sendChatMessage();
  });

  document.getElementById('btn-summarize')!.addEventListener('click', () => quickAction('summarize'));
  document.getElementById('btn-action-items')!.addEventListener('click', () => quickAction('action-items'));
  document.getElementById('btn-key-decisions')!.addEventListener('click', () => quickAction('key-decisions'));


  const bannerSettingsBtn = document.getElementById('btn-banner-settings');
  if (bannerSettingsBtn) bannerSettingsBtn.addEventListener('click', openSettings);

  const refreshBtn = document.getElementById('btn-refresh-suggestions');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    if (state.transcript.length === 0) {
      showToast('Start recording first to get suggestions', 'info');
    } else {
      requestSuggestions();
    }
  });

  // Reload suggestions button (if present)
  const reloadBtn = document.getElementById('btn-reload-suggestions');
  if (reloadBtn) reloadBtn.addEventListener('click', () => requestSuggestions());

  // Click suggestion card → send to chat
  document.querySelectorAll('.suggestion-card[data-suggestion]').forEach(card => {
    card.addEventListener('click', () => {
      const text = (card as HTMLElement).dataset.suggestion || '';
      if (text) {
        state.chatMessages.push({ role: 'user', text: `Detailed answer to: "${text}"` });
        state.chatHistory.push({ role: 'user', content: `Give me a detailed answer about this suggestion from my meeting: "${text}". Use the full transcript context.` });
        saveState();
        updateChatUI();
        sendChatFromSuggestion(text);
      }
    });
  });
}

// ===== Recording =====
function toggleRecording(): void {
  if (state.recorderState === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording(): void {
  if (!getApiKey()) {
    showToast('Please set your Groq API key in Settings first', 'error');
    openSettings();
    return;
  }


  recorder.start();

  // Reset timer for new recording session
  state.elapsedSeconds = 0;
  const timerEl = document.querySelector('.mic-timer');
  if (timerEl) timerEl.textContent = formatTime(0);

  timerInterval = setInterval(() => {
    state.elapsedSeconds++;
    const el = document.getElementById('record-timer');
    if (el) el.textContent = formatTime(state.elapsedSeconds);
  }, 1000);

  // Auto-refresh suggestions every 45 seconds while recording
  autoRefreshInterval = setInterval(() => {
    if (state.recorderState === 'recording' && state.transcript.length > 0) {
      requestSuggestions();
    }
  }, 45000);
}

function stopRecording(): void {
  recorder.stop();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  // Reset visualizer bars to flat
  const bars = document.querySelectorAll('.visualizer-bar');
  bars.forEach((bar) => {
    (bar as HTMLElement).style.height = '4px';
  });

  // Update quick action buttons based on transcript availability
  const btns = ['btn-summarize', 'btn-action-items', 'btn-key-decisions'];
  btns.forEach(id => {
    const el = document.getElementById(id) as HTMLButtonElement;
    if (el) el.disabled = state.transcript.length === 0;
  });

  showToast('Recording stopped', 'info');
}

// ===== Audio Callbacks =====
async function handleAudioData(blob: Blob): Promise<void> {
  if (blob.size < 1000) return;

  const statusEl = document.getElementById('transcription-status');
  if (statusEl) statusEl.style.display = 'flex';

  try {
    const text = await transcribeAudio(blob);
    if (statusEl) statusEl.style.display = 'none';
    
    if (text && text.trim().length > 0) {
      state.transcript.push({
        timestamp: getCurrentTime(),
        text: text.trim(),
      });
      saveState();
      updateTranscriptUI();

      // Debounce suggestion generation
      if (suggestionDebounce) clearTimeout(suggestionDebounce);
      suggestionDebounce = setTimeout(() => requestSuggestions(), 2000);
    }
  } catch (err) {
    if (statusEl) statusEl.style.display = 'none';
    console.error('Transcription error:', err);
    showToast(`Transcription error: ${(err as Error).message}`, 'error');
  }
}

function updateTranscriptUI(): void {
  const body = document.getElementById('transcript-body');
  const count = document.getElementById('transcript-count');
  if (!body || !count) return;

  count.textContent = `${state.transcript.length} entries`;

  if (state.transcript.length === 1) {
    body.innerHTML = '';
  }

  const last = state.transcript[state.transcript.length - 1];
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';
  entry.innerHTML = `
    <div class="timestamp">${escapeHtml(last.timestamp)}</div>
    <div class="text">${escapeHtml(last.text)}</div>
  `;
  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
}

function handleVisualizerData(data: Uint8Array): void {
  const bars = document.querySelectorAll('.visualizer-bar');
  if (!bars.length) return;

  const step = Math.floor(data.length / bars.length);
  bars.forEach((bar, i) => {
    const value = data[i * step] || 0;
    const height = Math.max(4, (value / 255) * 56);
    (bar as HTMLElement).style.height = `${height}px`;
  });
}

function handleRecorderStateChange(recState: RecorderState): void {
  state.recorderState = recState;
  const isRecording = recState === 'recording';

  // Update record button
  const btn = document.getElementById('btn-record');
  if (btn) {
    btn.className = `btn btn-record ${isRecording ? 'recording' : ''}`;
    btn.innerHTML = isRecording ? '⏹' : '🎙';
  }

  // Update status badge
  const badge = document.querySelector('.status-badge');
  if (badge) {
    badge.className = `status-badge ${isRecording ? 'active' : 'idle'}`;
    badge.innerHTML = `<span class="dot"></span> ${isRecording ? 'Meeting in progress' : 'Ready to record'}`;
  }

  // Update meeting title and description
  const meetingStatus = document.querySelector('.meeting-status');
  if (meetingStatus) {
    const h2 = meetingStatus.querySelector('h2');
    const p = meetingStatus.querySelector('p');
    if (h2) h2.textContent = isRecording ? 'Recording Active' : 'Start Meeting';
    if (p) p.textContent = isRecording
      ? 'Capturing audio and generating insights...'
      : 'Click the microphone to begin your AI-powered session.';
  }
}

// ===== Suggestions =====
async function requestSuggestions(): Promise<void> {
  const transcript = getFullTranscriptText();
  if (!transcript || transcript.length < 20) return;

  state.isSuggestionsLoading = true;
  updateSuggestionsUI();

  try {
    const result = await generateSuggestions(transcript);
    
    // Robust JSON parsing (handles markdown blocks)
    let cleanJson = result.trim();
    if (cleanJson.includes('```')) {
      const match = cleanJson.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) cleanJson = match[1].trim();
    }
    
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed)) {
      const newSuggestions: Suggestion[] = parsed.map((s: { type: string; text: string }) => ({
        type: s.type as Suggestion['type'],
        text: s.text,
        time: getCurrentTime(),
      }));
      state.suggestions = [...newSuggestions, ...state.suggestions];
      saveState();
    }
  } catch (err) {
    console.error('Suggestions error:', err);
    showToast('Failed to generate suggestions. Please check your API key.', 'error');
  } finally {
    state.isSuggestionsLoading = false;
    updateSuggestionsUI();
  }
}

function updateSuggestionsUI(): void {
  const body = document.getElementById('suggestions-body');
  const count = document.getElementById('suggestion-count');
  if (!body || !count) return;

  count.textContent = `${state.suggestions.length}`;

  if (state.isSuggestionsLoading) {
    body.innerHTML = `
      <div class="transcript-empty" style="padding:20px;">
        <div class="spinner" style="width:24px;height:24px;margin-bottom:12px;"></div>
        <p style="font-size:13px;">Analyzing transcript...</p>
      </div>
    `;
    return;
  }

  if (state.suggestions.length === 0) {
    body.innerHTML = `
      <div class="transcript-empty">
        <div class="empty-icon">💡</div>
        <h3>No suggestions yet</h3>
        <p>AI suggestions will appear here as the meeting progresses.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = state.suggestions.map(s => `
    <div class="suggestion-card" data-suggestion="${escapeHtml(s.text)}">
      <div class="suggestion-type ${escapeHtml(s.type)}">
        ${s.type === 'action' ? '⚡ Action' : s.type === 'insight' ? '🔍 Insight' : s.type === 'question' ? '❓ Question' : '📄 Summary'}
      </div>
      <div class="suggestion-text">${escapeHtml(s.text)}</div>
      <div class="suggestion-time">${escapeHtml(s.time)}</div>
    </div>
  `).join('');

  // Re-attach suggestion click handlers since we replaced innerHTML
  body.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const text = (card as HTMLElement).dataset.suggestion || '';
      if (text) {
        state.chatMessages.push({ role: 'user', text: `Tell me more about: "${text}"` });
        state.chatHistory.push({ role: 'user', content: `Give me more context or details about this suggestion from our meeting: "${text}".` });
        saveState();
        updateChatUI();
        sendChatFromSuggestion(text);
      }
    });
  });
}

// ===== Chat =====
function toggleChat(): void {
  state.isChatOpen = !state.isChatOpen;
  const content = document.getElementById('chat-content');
  const toggle = document.querySelector('#chat-toggle span:last-child');
  if (content) content.classList.toggle('hidden', !state.isChatOpen);
  if (toggle) toggle.textContent = state.isChatOpen ? '▼' : '▲';
}

async function sendChatMessage(): Promise<void> {
  const input = document.getElementById('chat-input') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;

  if (!getApiKey()) {
    showToast('Please set your Groq API key in Settings', 'error');
    return;
  }

  input.value = '';
  state.chatMessages.push({ role: 'user', text });
  state.chatHistory.push({ role: 'user', content: text });
  saveState();
  updateChatUI();

  // Show typing indicator
  const messagesEl = document.getElementById('chat-messages')!;
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-message ai';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = `
    <div class="chat-role-label">ASSISTANT</div>
    <div class="chat-content">
      <div class="typing-indicator">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
    </div>
  `;
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const response = await chatAboutMeeting(
      getFullTranscriptText(),
      state.chatHistory.slice(0, -1),
      text
    );

    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();

    state.chatMessages.push({ role: 'ai', text: response });
    state.chatHistory.push({ role: 'assistant', content: response });
    saveState();
    updateChatUI();
  } catch (err) {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    showToast(`Chat error: ${(err as Error).message}`, 'error');
  }
}

function updateChatUI(): void {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  messagesEl.innerHTML = state.chatMessages.map(m => `
    <div class="chat-message ${m.role}">
      <div class="avatar">${m.role === 'user' ? 'ME' : 'TM'}</div>
      <div class="content">${m.role === 'ai' ? renderMarkdown(m.text) : escapeHtml(m.text)}</div>
    </div>
  `).join('');
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Attach copy button handlers
  messagesEl.querySelectorAll('.code-copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const codeEl = btn.parentElement?.querySelector('code');
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.innerText).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      }
    });
  });
}

async function sendChatFromSuggestion(suggestionText: string): Promise<void> {
  const messagesEl = document.getElementById('chat-messages')!;
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-message ai';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = '<div class="chat-role-label">ASSISTANT</div><div class="chat-content"><div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const response = await chatAboutMeeting(
      getFullTranscriptText(),
      state.chatHistory.slice(0, -1),
      `Give me a detailed answer about: "${suggestionText}". Use the meeting transcript context.`
    );
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    state.chatMessages.push({ role: 'ai', text: response });
    state.chatHistory.push({ role: 'assistant', content: response });
    saveState();
    updateChatUI();
  } catch (err) {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    showToast(`Chat error: ${(err as Error).message}`, 'error');
  }
}

// ===== Quick Actions =====
async function quickAction(action: string): Promise<void> {
  const transcript = getFullTranscriptText();
  if (!transcript) {
    showToast('No transcript available', 'error');
    return;
  }

  if (!getApiKey()) {
    showToast('Please set your Groq API key in Settings', 'error');
    return;
  }

  const prompts: Record<string, string> = {
    'summarize': 'Provide a concise summary of this meeting transcript in 3-5 bullet points:',
    'action-items': 'Extract all action items from this meeting transcript as a clear numbered list:',
    'key-decisions': 'List the key decisions made in this meeting transcript:',
  };

  state.chatMessages.push({ role: 'user', text: `📌 ${action.replace('-', ' ').toUpperCase()}` });
  state.chatHistory.push({ role: 'user', content: prompts[action] + '\n\n' + transcript });
  saveState();
  updateChatUI();

  // Ensure chat is open
  if (!state.isChatOpen) toggleChat();

  try {
    const response = await chatAboutMeeting(transcript, [], prompts[action] + '\n\n' + transcript);
    state.chatMessages.push({ role: 'ai', text: response });
    state.chatHistory.push({ role: 'assistant', content: response });
    saveState();
    updateChatUI();
  } catch (err) {
    showToast(`Error: ${(err as Error).message}`, 'error');
  }
}

// ===== Settings =====
function openSettings(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settings-modal';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>⚙️ Settings</h2>
        <button class="btn btn-ghost btn-icon" id="btn-close-settings">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="input-api-key">Groq API Key</label>
          <input type="password" class="form-input" id="input-api-key" 
            placeholder="gsk_..." value="${getApiKey()}" />
          <div class="hint">Get your API key at <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent-secondary);">console.groq.com/keys</a></div>
        </div>
        <div class="form-group">
          <label for="select-model">Chat Model</label>
          <select class="form-select" id="select-model">
            <option value="llama-3.3-70b-versatile" ${getModel() === 'llama-3.3-70b-versatile' ? 'selected' : ''}>Llama 3.3 70B Versatile</option>
            <option value="llama-3.1-8b-instant" ${getModel() === 'llama-3.1-8b-instant' ? 'selected' : ''}>Llama 3.1 8B Instant</option>
            <option value="gemma2-9b-it" ${getModel() === 'gemma2-9b-it' ? 'selected' : ''}>Gemma 2 9B IT</option>
            <option value="openai/gpt-oss-20b" ${getModel() === 'openai/gpt-oss-20b' ? 'selected' : ''}>GPT-OSS 20B</option>
            <option value="openai/gpt-oss-120b" ${getModel() === 'openai/gpt-oss-120b' ? 'selected' : ''}>GPT-OSS 120B</option>
          </select>
          <div class="hint">Model used for suggestions and chat responses</div>
        </div>
        <div class="form-group">
          <label for="select-whisper">Whisper Model</label>
          <select class="form-select" id="select-whisper">
            <option value="whisper-large-v3-turbo" ${getWhisperModel() === 'whisper-large-v3-turbo' ? 'selected' : ''}>Whisper Large V3 Turbo (Fast)</option>
            <option value="whisper-large-v3" ${getWhisperModel() === 'whisper-large-v3' ? 'selected' : ''}>Whisper Large V3 (Accurate)</option>
          </select>
          <div class="hint">Model used for audio transcription</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-cancel-settings">Cancel</button>
        <button class="btn btn-ghost" id="btn-test-api" style="margin-right: auto;">Test Connection</button>
        <button class="btn btn-primary" id="btn-save-settings">Save Settings</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettings();
  });
  document.getElementById('btn-close-settings')!.addEventListener('click', closeSettings);
  document.getElementById('btn-cancel-settings')!.addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings')!.addEventListener('click', saveSettings);
  
  document.getElementById('btn-test-api')!.addEventListener('click', async () => {
    const key = (document.getElementById('input-api-key') as HTMLInputElement).value;
    if (!key) {
      showToast('Please enter an API key first', 'error');
      return;
    }
    
    const btn = document.getElementById('btn-test-api') as HTMLButtonElement;
    const originalText = btn.textContent;
    btn.textContent = 'Testing...';
    btn.disabled = true;
    
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (response.ok) {
        showToast('Connection successful!', 'success');
      } else {
        const err = await response.json().catch(() => ({}));
        showToast(`Connection failed: ${err.error?.message || response.status}`, 'error');
      }
    } catch (err) {
      showToast(`Network error: ${(err as Error).message}`, 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

function closeSettings(): void {
  document.getElementById('settings-modal')?.remove();
}

function saveSettings(): void {
  const apiKeyInput = document.getElementById('input-api-key') as HTMLInputElement;
  const modelSelect = document.getElementById('select-model') as HTMLSelectElement;
  const whisperSelect = document.getElementById('select-whisper') as HTMLSelectElement;

  setApiKey(apiKeyInput.value.trim());
  setModel(modelSelect.value);
  setWhisperModel(whisperSelect.value);

  closeSettings();
  renderApp();
  showToast('Settings saved successfully', 'success');
}

// ===== Clear Session =====
function clearSession(): void {
  if (state.recorderState === 'recording') {
    stopRecording();
  }
  state.transcript = [];
  state.suggestions = [];
  state.chatMessages = [];
  state.chatHistory = [];
  state.elapsedSeconds = 0;
  localStorage.removeItem(STORAGE_KEY);
  renderApp();
  showToast('Session cleared', 'info');
}

// ===== Auth Pages =====
function renderLoginPage(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo-container" style="display: flex; justify-content: center; margin-bottom: 24px;">
            <img src="/twinmind-logo.png" alt="TwinMind Logo" class="auth-logo" style="width: 80px; height: 80px; border-radius: 20px; box-shadow: var(--shadow-lg);" />
          </div>
          <h1>Welcome Back</h1>
          <p>The smartest AI meeting copilot for teams.</p>
        </div>
        <form id="login-form" class="auth-form">
          <div class="auth-field">
            <label for="login-identifier">Username or Email</label>
            <input type="text" id="login-identifier" placeholder="Enter username or email" autocomplete="username" />
          </div>
          <div class="auth-field">
            <label for="login-password">Password</label>
            <input type="password" id="login-password" placeholder="Enter password" autocomplete="current-password" />
          </div>
          <div id="login-error" class="auth-error"></div>
          <button type="submit" class="btn btn-primary auth-submit">Sign In</button>
        </form>
        <div class="auth-footer">
          Don't have an account? <a href="#" id="goto-register">Create one</a>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = (document.getElementById('login-identifier') as HTMLInputElement).value.trim();
    const password = (document.getElementById('login-password') as HTMLInputElement).value;
    const errorEl = document.getElementById('login-error')!;
    errorEl.textContent = '';

    const result = await login(identifier, password);
    if (result.success) {
      init();
    } else {
      errorEl.textContent = result.error || 'Login failed';
    }
  });

  document.getElementById('goto-register')!.addEventListener('click', (e) => {
    e.preventDefault();
    renderRegisterPage();
  });
}

function renderRegisterPage(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <img src="/twinmind-logo.png" alt="TwinMind Logo" class="auth-logo" />
          <h1>Create Account</h1>
          <p>Join TwinMind AI Chat</p>
        </div>
        <form id="register-form" class="auth-form">
          <div class="auth-field">
            <label for="reg-username">Username</label>
            <input type="text" id="reg-username" placeholder="Choose a username" autocomplete="username" />
          </div>
          <div class="auth-field">
            <label for="reg-email">Email</label>
            <input type="email" id="reg-email" placeholder="Enter your email" autocomplete="email" />
          </div>
          <div class="auth-field">
            <label for="reg-password">Password</label>
            <input type="password" id="reg-password" placeholder="Min 6 characters" autocomplete="new-password" />
          </div>
          <div class="auth-field">
            <label for="reg-confirm">Confirm Password</label>
            <input type="password" id="reg-confirm" placeholder="Repeat password" autocomplete="new-password" />
          </div>
          <div id="register-error" class="auth-error"></div>
          <button type="submit" class="btn btn-primary auth-submit">Create Account</button>
        </form>
        <div class="auth-footer">
          Already have an account? <a href="#" id="goto-login">Sign in</a>
        </div>
      </div>
    </div>
  `;

  document.getElementById('register-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
    const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;
    const confirm = (document.getElementById('reg-confirm') as HTMLInputElement).value;
    const errorEl = document.getElementById('register-error')!;
    errorEl.textContent = '';

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match';
      return;
    }

    const result = await register(username, email, password);
    if (result.success) {
      init();
    } else {
      errorEl.textContent = result.error || 'Registration failed';
    }
  });

  document.getElementById('goto-login')!.addEventListener('click', (e) => {
    e.preventDefault();
    renderLoginPage();
  });
}

function handleLogout(): void {
  logout();
  renderLoginPage();
}


// ===== Initialize =====
function init(): void {
  if (!isLoggedIn()) {
    renderLoginPage();
    return;
  }

  loadState();

  recorder = new AudioRecorder({
    onDataAvailable: handleAudioData,
    onVisualizerData: handleVisualizerData,
    onStateChange: handleRecorderStateChange,
    onError: (err) => showToast(err.message, 'error'),
  });

  renderApp();

  if (!getApiKey()) {
    setTimeout(() => {
      showToast('Welcome! Set your Groq API key in Settings to get started.', 'info');
    }, 1000);
  }
}

init();
