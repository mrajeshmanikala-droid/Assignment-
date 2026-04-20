# TwinMind AI Copilot

TwinMind AI Copilot is a real-time, AI-powered meeting assistant built to enhance your productivity. It listens to your meetings, provides live transcriptions, generates actionable insights, and features an interactive AI chat to help you dive deeper into meeting topics.

## Features

- **Real-Time Transcription**: Captures audio and transcribes it instantly using Groq's Whisper API.
- **Live AI Suggestions**: Automatically generates action items, key insights, and questions every 45 seconds during an active meeting.
- **Interactive Chat Assistant**: Chat with TwinMind to summarize discussions, clarify points, or extract specific details from the ongoing meeting.
- **SaaS Subscription Model**: Includes tiered access (Free, Pro, Enterprise) with feature gating and a premium pricing dashboard.
- **Session Persistence**: Transcripts, suggestions, and chat history are saved locally so you don't lose context if you refresh the page.
- **Compact & Responsive UI**: A modern, 3-column dashboard designed for power users, featuring sticky recording controls and scrollable insight panels.

## Tech Stack

- **Frontend**: HTML, CSS (Vanilla with custom variables and themes), TypeScript
- **Build Tool**: Vite
- **AI Integrations**: Groq API (Whisper for audio, Llama-3 for chat and suggestions)
- **State Management**: LocalStorage for session and authentication persistence

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- A Groq API Key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mrajeshmanikala-droid/Assignment-.git
   cd Assignment-
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173/`.

### Configuration

To fully utilize the AI features, you need to configure your Groq API key:
1. Create an account on the application.
2. Click the gear icon (⚙️) in the top right corner to open Settings.
3. Enter your Groq API Key and click Save.

## Usage

1. **Sign In**: Create a local account to access the dashboard.
2. **Start Meeting**: Click the microphone icon to begin recording. Ensure your browser has permission to access the microphone.
3. **Monitor Insights**: Watch the transcript populate and review AI suggestions as they appear.
4. **Chat**: Use the right panel to ask specific questions about the meeting.
5. **Export**: When finished, click the "Export" button to download a markdown summary of your session.

## License

This project is for demonstration and assignment purposes.
