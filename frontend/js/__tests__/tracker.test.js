import { describe, it, expect } from 'vitest';
import { TrackerStateMachine, STATES } from '../tracker.js';

describe('TrackerStateMachine', () => {
  it('starts in idle', () => {
    const m = new TrackerStateMachine();
    expect(m.state).toBe(STATES.idle);
  });

  it('idle → camera_on on cameraReady', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    expect(m.state).toBe(STATES.camera_on);
  });

  it('camera_on → awaiting_click on startTracking', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    expect(m.state).toBe(STATES.awaiting_click);
  });

  it('awaiting_click → tracking on click', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    expect(m.state).toBe(STATES.tracking);
    expect(m.target).toEqual({ x: 100, y: 100 });
  });

  it('tracking stays in tracking on detectOk', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('detectOk');
    expect(m.state).toBe(STATES.tracking);
    expect(m.consecutiveFail).toBe(0);
  });

  it('tracking → lost after 8 consecutive fails', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
  });

  it('lost → awaiting_click after further failures', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
    for (let i = 0; i < 30; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.awaiting_click);
  });

  it('lost → tracking on detectOk', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
    m.send('detectOk');
    expect(m.state).toBe(STATES.tracking);
  });

  it('escape clears target and returns to awaiting_click', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('clearTarget');
    expect(m.state).toBe(STATES.awaiting_click);
    expect(m.target).toBeNull();
  });

  it('drift triggers re-click prompt (transitions to awaiting_click)', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('drift');
    expect(m.state).toBe(STATES.awaiting_click);
    expect(m.target).toBeNull();
  });
});
