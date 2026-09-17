import { Injectable, signal } from '@angular/core';

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  resultIndex: number;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly ctor = getSpeechRecognitionCtor();
  private recognition: SpeechRecognitionLike | null = null;

  readonly supported = !!this.ctor;
  readonly listening = signal(false);

  stop(): void {
    this.recognition?.stop();
  }

  /**
   * Streams interim + final transcripts as the user speaks, rather than
   * waiting for silence. Callers are responsible for combining a stable
   * "committed" prefix (built from final results) with the latest interim
   * text on each call.
   */
  startDictation(onTranscript: (transcript: string, isFinal: boolean) => void, onError?: () => void): void {
    if (!this.ctor || this.listening()) return;

    const recognition = new this.ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        onTranscript(transcript, result.isFinal);
      }
    };
    recognition.onerror = () => {
      onError?.();
    };
    recognition.onend = () => {
      this.listening.set(false);
      this.recognition = null;
    };

    this.recognition = recognition;
    this.listening.set(true);
    recognition.start();
  }
}
