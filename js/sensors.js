// Bewegungssensoren und Mikrofon. Erkennt den Schuss an einem Sprung in der Beschleunigung
// und liefert die Bewegung 1,5 s davor bis 0,3 s danach.

const DEG = Math.PI / 180;
const PRE_MS = 1500;
const POST_MS = 300;
const KEEP_MS = 4000;
const MIN_GAP_MS = 1000;
const MIC_WINDOW_MS = 150;
const MIC_THRESHOLD = 0.5;

export class MotionRecorder {
  constructor() {
    this.buf = [];
    this.handlers = {};
    this.threshold = 8;
    this.requireMic = false;
    this.armed = true;
    this.level = 0;
    this.rate = 0;
    this.raw = null;
    this.pending = null;
    this.lastShot = -Infinity;
    this.prev = null;
    this.mic = null;
    this.micPeaks = [];
    this.micLevel = 0;
    this.running = false;
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, payload) {
    this.handlers[name]?.(payload);
  }

  // Muss direkt aus einem Tipp heraus aufgerufen werden (iOS-Freigabe).
  async start({ mic = false } = {}) {
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('nomotion');
    const audioCtx = mic ? new (window.AudioContext || window.webkitAudioContext)() : null;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') throw new Error('denied');
    }
    this._onMotion = (e) => this.onMotion(e);
    window.addEventListener('devicemotion', this._onMotion);
    if (audioCtx) await this.startMic(audioCtx);
    this.running = true;
    // Kommt nach 1,5 s kein Messwert, hat das Gerät keine Bewegungssensoren (z. B. am PC)
    await new Promise((res) => setTimeout(res, 1500));
    if (!this.buf.length) {
      this.stop();
      throw new Error('nodata');
    }
  }

  async startMic(ctx) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      ctx.close();
      throw new Error('micdenied');
    }
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const arr = new Float32Array(an.fftSize);
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(arr);
      let p = 0;
      for (let i = 0; i < arr.length; i++) p = Math.max(p, Math.abs(arr[i]));
      const t = performance.now();
      this.micLevel = p;
      this.micPeaks.push({ t, p });
      while (this.micPeaks.length && this.micPeaks[0].t < t - 2000) this.micPeaks.shift();
    }, 10);
    this.mic = { ctx, stream, timer };
  }

  stop() {
    if (this._onMotion) window.removeEventListener('devicemotion', this._onMotion);
    if (this.mic) {
      clearInterval(this.mic.timer);
      this.mic.stream.getTracks().forEach((t) => t.stop());
      this.mic.ctx.close();
      this.mic = null;
    }
    this.running = false;
  }

  onMotion(e) {
    const r = e.rotationRate;
    const a = e.acceleration;
    if (!r || !a) return;
    const now = performance.now();
    const t = e.timeStamp > 0 && Math.abs(e.timeStamp - now) < 1000 ? e.timeStamp : now;
    // rotationRate: alpha = um z, beta = um x, gamma = um y (Grad/s)
    const s = {
      t,
      gx: (r.beta || 0) * DEG,
      gy: (r.gamma || 0) * DEG,
      gz: (r.alpha || 0) * DEG,
      ax: a.x || 0,
      ay: a.y || 0,
      az: a.z || 0,
    };
    const last = this.buf[this.buf.length - 1];
    if (last) {
      const dt = t - last.t;
      if (dt > 0) this.rate = this.rate ? this.rate * 0.95 + (1000 / dt) * 0.05 : 1000 / dt;
    }
    this.buf.push(s);
    while (this.buf.length && this.buf[0].t < t - KEEP_MS) this.buf.shift();
    if (this.raw) this.raw.push(s);

    this.level = this.prev ? Math.hypot(s.ax - this.prev.ax, s.ay - this.prev.ay, s.az - this.prev.az) : 0;
    this.prev = s;

    if (this.armed && !this.pending && this.level > this.threshold && t - this.lastShot > MIN_GAP_MS) {
      this.pending = { t, manual: false };
    }
    if (this.pending && t >= this.pending.t + POST_MS) this.finish();
  }

  markShot() {
    if (this.pending) return;
    const last = this.buf[this.buf.length - 1];
    this.pending = { t: last ? last.t : performance.now(), manual: true };
  }

  finish() {
    const { t, manual } = this.pending;
    this.pending = null;
    if (!manual && this.requireMic && this.mic) {
      const heard = this.micPeaks.some((m) => Math.abs(m.t - t) <= MIC_WINDOW_MS && m.p >= MIC_THRESHOLD);
      if (!heard) {
        this.emit('rejected', { t });
        return;
      }
    }
    this.lastShot = t;
    const trace = this.buf
      .filter((s) => s.t >= t - PRE_MS && s.t <= t + POST_MS)
      .map((s) => ({ ...s, t: Math.round((s.t - t) * 10) / 10 }));
    this.raw?.push({ shot: true, t });
    this.emit('shot', { trace, manual, rate: this.rate });
  }

  startRaw() {
    this.raw = [];
  }

  stopRaw() {
    const r = this.raw;
    this.raw = null;
    return r || [];
  }
}

export async function requestWakeLock() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}
