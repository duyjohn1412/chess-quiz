class SoundEffects {
  private ctx: AudioContext | null = null;
  enabled = true;

  private ensureCtx(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.08): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  move(): void {
    this.beep(320, 0.06, 'triangle', 0.07);
  }

  correct(): void {
    this.beep(523, 0.09, 'sine', 0.09);
    setTimeout(() => this.beep(659, 0.14, 'sine', 0.09), 70);
  }

  wrong(): void {
    this.beep(220, 0.18, 'sawtooth', 0.07);
  }

  buy(): void {
    this.beep(784, 0.08, 'triangle', 0.08);
    setTimeout(() => this.beep(988, 0.11, 'triangle', 0.08), 65);
  }

  flash(): void {
    this.beep(1150, 0.12, 'square', 0.05);
  }

  shield(): void {
    this.beep(440, 0.08, 'sine', 0.08);
    setTimeout(() => this.beep(880, 0.14, 'sine', 0.08), 60);
  }
}

export const soundFx = new SoundEffects();
