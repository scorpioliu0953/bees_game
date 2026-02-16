class AudioManager {
  private ctx: AudioContext | null = null;
  private bgmInterval: any = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private createOscillator(freq: number, type: OscillatorType = 'square') {
    this.init();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    osc.type = type;
    osc.connect(gain);
    gain.connect(this.ctx!.destination);
    return { osc, gain };
  }

  playBGM() {
    this.stopBGM();
    this.init();
    
    const playNote = (time: number, freq: number) => {
      if (!this.ctx) return;
      const { osc, gain } = this.createOscillator(freq, 'triangle');
      gain.gain.setValueAtTime(0.05, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      osc.start(time);
      osc.stop(time + 0.4);
    };

    const loop = () => {
      if (this.ctx?.state !== 'running') return;
      const startTime = this.ctx.currentTime + 0.1;
      const notes = [110, 110, 164, 110, 130, 110, 164, 146];
      notes.forEach((freq, i) => {
        playNote(startTime + i * 0.5, freq);
      });
    };

    loop();
    this.bgmInterval = setInterval(loop, 4000);
  }

  stopBGM() {
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  playShoot() {
    const { osc, gain } = this.createOscillator(880, 'triangle');
    const now = this.ctx!.currentTime;
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start();
    osc.stop(now + 0.1);
  }

  playExplosion() {
    const { osc, gain } = this.createOscillator(100, 'sawtooth');
    const now = this.ctx!.currentTime;
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);
    osc.start();
    osc.stop(now + 0.4);
  }

  playPowerUp() {
    const { osc, gain } = this.createOscillator(440, 'sine');
    const now = this.ctx!.currentTime;
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start();
    osc.stop(now + 0.2);
  }

  playGameOver() {
    const { osc, gain } = this.createOscillator(220, 'square');
    const now = this.ctx!.currentTime;
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.6);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);
    osc.start();
    osc.stop(now + 0.6);
  }

  playBossSpawn() {
    const { osc, gain } = this.createOscillator(55, 'sawtooth');
    const now = this.ctx!.currentTime;
    osc.frequency.setValueAtTime(55, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 1);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 1);
    osc.start();
    osc.stop(now + 1);
  }
}

export const audio = new AudioManager();
