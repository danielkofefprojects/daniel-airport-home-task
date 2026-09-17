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
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
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

  start(onResult: (transcript: string) => void, onError?: () => void): void {
    if (!this.ctor || this.listening()) return;

    const recognition = new this.ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onResult(transcript);
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

  stop(): void {
    this.recognition?.stop();
  }
}
