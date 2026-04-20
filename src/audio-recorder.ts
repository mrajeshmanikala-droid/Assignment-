// ===== Audio Recorder with Web Audio API =====

export type RecorderState = 'idle' | 'recording' | 'paused';

export interface AudioRecorderCallbacks {
  onDataAvailable: (blob: Blob) => void;
  onVisualizerData: (data: Uint8Array) => void;
  onStateChange: (state: RecorderState) => void;
  onError: (error: Error) => void;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private animFrameId: number | null = null;
  private callbacks: AudioRecorderCallbacks;
  private _state: RecorderState = 'idle';
  private chunkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: AudioRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  get state(): RecorderState {
    return this._state;
  }

  private setState(state: RecorderState): void {
    this._state = state;
    this.callbacks.onStateChange(state);
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      // Set up audio visualization
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
      this.startVisualization();

      // Set up media recorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        if (this.chunks.length > 0) {
          const blob = new Blob(this.chunks, { type: mimeType });
          this.callbacks.onDataAvailable(blob);
          this.chunks = [];
        }
      };

      this.mediaRecorder.start();
      this.setState('recording');

      // Send chunks every 8 seconds for real-time transcription
      this.chunkInterval = setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
          this.mediaRecorder.start();
        }
      }, 8000);

    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err : new Error('Failed to access microphone')
      );
    }
  }

  stop(): void {
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    
    this.stopVisualization();
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaRecorder = null;
    this.analyser = null;
    this.setState('idle');
  }

  private startVisualization(): void {
    const draw = () => {
      if (!this.analyser) return;
      this.animFrameId = requestAnimationFrame(draw);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      this.callbacks.onVisualizerData(data);
    };
    draw();
  }

  private stopVisualization(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
