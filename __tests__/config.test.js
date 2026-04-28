import fs from 'fs';
import os from 'os';
import path from 'path';
import { configEvents, initConfig, loadConfig, reloadAndNotify } from '../src/config/config.js';

describe('config loader', () => {
  let tempDir;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multistream-config-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    configEvents.removeAllListeners('configReloaded');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('loadConfig merges defaults with config.yaml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'config.yaml'),
      `platforms:\n  twitch:\n    enabled: true\n    streamKey: test-key\nserver:\n  apiPort: 8080\n`
    );

    const config = loadConfig();

    expect(config.platforms.twitch.enabled).toBe(true);
    expect(config.platforms.twitch.streamKey).toBe('test-key');
    expect(config.platforms.youtube.rtmpUrl).toBe('rtmp://a.rtmp.youtube.com/live2');
    expect(config.server.apiPort).toBe(8080);
    expect(config.server.rtmpPort).toBe(1935);
  });

  test('reloadAndNotify emits only when config changes', () => {
    fs.writeFileSync(path.join(tempDir, 'config.yaml'), 'server:\n  apiPort: 8000\n');
    initConfig();

    const reloaded = [];
    configEvents.on('configReloaded', (newConfig) => {
      reloaded.push(newConfig.server.apiPort);
    });

    expect(reloadAndNotify()).toBe(false);

    fs.writeFileSync(path.join(tempDir, 'config.yaml'), 'server:\n  apiPort: 8100\n');
    expect(reloadAndNotify()).toBe(true);

    expect(reloaded).toEqual([8100]);
  });

  test('loadConfig throws when config.yaml is missing', () => {
    expect(() => loadConfig()).toThrow('config.yaml not found');
  });
});
