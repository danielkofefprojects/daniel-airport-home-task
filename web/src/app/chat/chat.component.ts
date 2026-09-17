import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from '../models';
import { ChatService, ChatStreamError } from '../services/chat.service';
import { VoiceService } from '../services/voice.service';
import { EvidenceComponent } from './evidence.component';
import { MarkdownPipe } from './markdown.pipe';

const QUICK_PICKS = [
  'Which airports have the strongest investment opportunity right now?',
  'Compare demand pressure at ORD and DFW',
  'Show me flight mix for ATL',
  'Which medium hubs look under-served relative to demand?'
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, EvidenceComponent, MarkdownPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent {
  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly loading = signal(false);
  readonly streaming = signal(false);
  readonly error = signal<string | null>(null);
  readonly quickPicks = QUICK_PICKS;

  private readonly chatService = inject(ChatService);
  private readonly voiceService = inject(VoiceService);

  readonly voiceSupported = this.voiceService.supported;
  readonly listening = this.voiceService.listening;

  private dictationBase = '';

  /** Continuously pastes interim + final speech into the input as the user talks. */
  toggleVoice(): void {
    if (this.listening()) {
      this.voiceService.stop();
      return;
    }
    this.error.set(null);
    this.dictationBase = this.draft() ? this.draft() + ' ' : '';
    this.voiceService.startDictation(
      (transcript, isFinal) => {
        this.draft.set(this.dictationBase + transcript);
        if (isFinal) {
          this.dictationBase = this.draft() ? this.draft() + ' ' : '';
        }
      },
      () => this.error.set('Could not hear you. Please try again or type your question.')
    );
  }

  async sendQuickPick(text: string): Promise<void> {
    if (this.loading()) return;
    this.draft.set(text);
    await this.send();
  }

  async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.loading()) return;

    this.messages.update((msgs) => [...msgs, { role: 'user', text }]);
    this.draft.set('');
    this.loading.set(true);
    this.streaming.set(false);
    this.error.set(null);

    let agentIndex = -1;

    try {
      await this.chatService.streamMessage(text, {
        onToken: (token) => {
          if (agentIndex === -1) {
            this.loading.set(false);
            this.streaming.set(true);
            this.messages.update((msgs) => {
              agentIndex = msgs.length;
              return [...msgs, { role: 'agent', text: token }];
            });
            return;
          }
          this.messages.update((msgs) =>
            msgs.map((m, i) => (i === agentIndex ? { ...m, text: m.text + token } : m))
          );
        },
        onDone: (result) => {
          this.messages.update((msgs) =>
            msgs.map((m, i) =>
              i === agentIndex ? { ...m, text: result.answer || m.text, evidence: result.evidence } : m
            )
          );
        }
      });
    } catch (err) {
      this.error.set(
        err instanceof ChatStreamError && err.code === 'RATE_LIMITED'
          ? err.message
          : 'Something went wrong reaching the agent. Please try again.'
      );
      if (agentIndex !== -1) {
        this.messages.update((msgs) => msgs.filter((_, i) => i !== agentIndex));
      }
    } finally {
      this.loading.set(false);
      this.streaming.set(false);
    }
  }

  onEnter(event: Event): void {
    event.preventDefault();
    void this.send();
  }
}
