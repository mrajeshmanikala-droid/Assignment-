

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export interface TranscriptionResult {
  text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const DEFAULT_API_KEY = '';

export function getApiKey(): string {
  return localStorage.getItem('groq_api_key') || DEFAULT_API_KEY;
}

export function setApiKey(key: string): void {
  localStorage.setItem('groq_api_key', key);
}

export function getModel(): string {
  return localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile';
}

export function setModel(model: string): void {
  localStorage.setItem('groq_model', model);
}

export function getWhisperModel(): string {
  return localStorage.getItem('groq_whisper_model') || 'whisper-large-v3-turbo';
}

export function setWhisperModel(model: string): void {
  localStorage.setItem('groq_whisper_model', model);
}


export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API key not configured. Please set your Groq API key in Settings.');

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', getWhisperModel());
  formData.append('response_format', 'json');
  formData.append('language', 'en');

  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Transcription failed: ${response.status}`);
  }

  const data: TranscriptionResult = await response.json();
  return data.text;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API key not configured. Please set your Groq API key in Settings.');

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(),
      messages: messages,
      temperature: 0.7,
      max_completion_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Chat completion failed: ${response.status}`);
  }

  const data: ChatCompletionResponse = await response.json();
  return data.choices[0]?.message?.content || '';
}

export async function generateSuggestions(transcript: string): Promise<string> {
  const systemPrompt = `You are TwinMind, a world-class AI meeting copilot. Your goal is to provide high-value, concise, and actionable intelligence from meeting transcripts.

Analyze the transcript and provide 2-3 suggestions. Each suggestion must be specific to the conversation.
Types:
- "action": Concrete tasks, follow-ups, or commitments made by participants.
- "insight": Key takeaways, decisions, or patterns identified in the discussion.
- "question": Critical clarifying questions that should be asked to move the project forward.
- "summary": A very brief (1 sentence) summary of the current discussion phase.

ONLY return a JSON array. Example:
[{"type":"action","text":"Sarah to send the budget report by Friday."}, {"type":"insight","text":"The team agrees on the Q3 roadmap priorities."}]`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is the latest meeting transcript:\n\n${transcript}\n\nProvide contextual suggestions based on this transcript.` },
  ];

  return chatCompletion(messages);
}

export async function chatAboutMeeting(
  transcript: string,
  chatHistory: ChatMessage[],
  userMessage: string
): Promise<string> {
  const systemPrompt = `You are TwinMind, an AI meeting copilot. You have access to the meeting transcript below. Answer questions about the meeting, provide analysis, and help the user understand what was discussed. Be concise and helpful.

Meeting Transcript:
${transcript || '(No transcript available yet - the meeting has not started or no audio has been captured.)'}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatHistory,
    { role: 'user', content: userMessage },
  ];

  return chatCompletion(messages);
}
