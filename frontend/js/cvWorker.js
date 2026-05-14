/**
 * Main-thread wrapper around the OpenCV.js worker.
 * Resolves on `ready`, then exposes track() / chessboard() methods that
 * return promises.
 */

class CvWorker {
  constructor() {
    this.worker = new Worker(new URL('./cvWorker.worker.js', import.meta.url), { type: 'classic' });
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this._pending = []; // FIFO of awaiters
    this.worker.onmessage = (e) => this._onMessage(e);
    this.worker.onerror = (err) => {
      if (this._readyReject) this._readyReject(err);
      for (const p of this._pending) p.reject(err);
      this._pending.length = 0;
    };
  }

  ready() { return this._readyPromise; }

  track(bitmap, opts) {
    return this._send({ type: 'track', bitmap, ...opts }, [bitmap], 'trackResult');
  }

  chessboard(bitmap, patternSize) {
    return this._send({ type: 'chessboard', bitmap, patternSize }, [bitmap], 'chessboardResult');
  }

  _send(msg, transfer, replyType) {
    return new Promise((resolve, reject) => {
      this._pending.push({ replyType, resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  _onMessage(e) {
    const msg = e.data;
    if (msg.type === 'ready') {
      this.caps = msg.caps || null;
      this._readyResolve();
      this._readyResolve = null;
      return;
    }
    if (msg.type === 'diag') {
      // eslint-disable-next-line no-console
      console.log('[cvWorker diag]', msg);
      return;
    }
    const next = this._pending.shift();
    if (!next) return;
    if (msg.type === 'error') next.reject(new Error(msg.message));
    else if (msg.type === next.replyType) next.resolve(msg);
    else next.reject(new Error(`unexpected reply type: ${msg.type}`));
  }

  terminate() {
    this.worker.terminate();
  }
}

export default CvWorker;
