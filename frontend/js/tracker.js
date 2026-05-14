/**
 * Tracker state machine. Pure logic — no DOM, no worker, no Three.js.
 * The orchestrator in main.js wires events into `send(event, payload)`
 * and inspects `state`, `target`, `consecutiveFail`.
 */

export const STATES = Object.freeze({
  idle: 'idle',
  camera_on: 'camera_on',
  awaiting_click: 'awaiting_click',
  tracking: 'tracking',
  lost: 'lost',
  calibrating: 'calibrating',
});

export const FAIL_BEFORE_LOST = 8;
export const FAIL_BEFORE_DEMOTE = 30; // additional fails while lost → awaiting_click

export class TrackerStateMachine {
  constructor() {
    this.state = STATES.idle;
    this.target = null;
    this.originalClick = null;
    this.consecutiveFail = 0;
    this._failsInLost = 0;
  }

  send(event, payload = null) {
    switch (event) {
      case 'cameraReady':
        if (this.state === STATES.idle) this.state = STATES.camera_on;
        break;

      case 'startTracking':
        if (this.state === STATES.camera_on) this.state = STATES.awaiting_click;
        break;

      case 'stopTracking':
        this.state = STATES.camera_on;
        this.target = null;
        this.originalClick = null;
        this.consecutiveFail = 0;
        this._failsInLost = 0;
        break;

      case 'click':
        if (this.state === STATES.awaiting_click ||
            this.state === STATES.tracking ||
            this.state === STATES.lost) {
          this.target = { ...payload };
          this.originalClick = { ...payload };
          this.consecutiveFail = 0;
          this._failsInLost = 0;
          this.state = STATES.tracking;
        }
        break;

      case 'detectOk':
        if (this.state === STATES.tracking || this.state === STATES.lost) {
          this.state = STATES.tracking;
          this.consecutiveFail = 0;
          this._failsInLost = 0;
          if (payload && payload.centroid) this.target = { ...payload.centroid };
        }
        break;

      case 'detectFail':
        if (this.state === STATES.tracking) {
          this.consecutiveFail++;
          if (this.consecutiveFail >= FAIL_BEFORE_LOST) {
            this.state = STATES.lost;
            this._failsInLost = 0;
          }
        } else if (this.state === STATES.lost) {
          this._failsInLost++;
          if (this._failsInLost >= FAIL_BEFORE_DEMOTE) {
            this.state = STATES.awaiting_click;
            this.target = null;
            this.originalClick = null;
            this.consecutiveFail = 0;
            this._failsInLost = 0;
          }
        }
        break;

      case 'clearTarget':
      case 'drift':
        if (this.state === STATES.tracking ||
            this.state === STATES.lost ||
            this.state === STATES.awaiting_click) {
          this.state = STATES.awaiting_click;
          this.target = null;
          this.originalClick = null;
          this.consecutiveFail = 0;
          this._failsInLost = 0;
        }
        break;

      case 'enterCalibration':
        if (this.state === STATES.camera_on || this.state === STATES.awaiting_click) {
          this._returnFrom = this.state;
          this.state = STATES.calibrating;
        }
        break;

      case 'exitCalibration':
        if (this.state === STATES.calibrating) {
          this.state = this._returnFrom || STATES.camera_on;
        }
        break;

      default:
        // Ignore unknown events.
        break;
    }
  }
}
