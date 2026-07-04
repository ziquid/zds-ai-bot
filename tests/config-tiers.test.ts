/**
 * Unit tests for the multi-tiered config resolution/merge system (zds-bot #3/#4)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveConfigTierPaths, loadTieredJsonConfig } from '../src/utils/config-tiers.js';

describe('config-tiers', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'ZDS_AI_ROOT',
    'ZDS_AI_BOT_GLOBAL_CONFIG_DIR',
    'ZDS_AI_BOT_CONFIG_DIR',
    'ZDS_AI_AGENT_CONFIG_HOME',
    'ZDS_AI_PROJECT_DIR',
    'ZDS_AI_TASK_DIR',
  ];
  let originalCwd: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'config-tiers-test-'));
    originalCwd = process.cwd();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeJson(dir: string, filename: string, data: any) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(data));
  }

  it('returns no paths when nothing exists', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    const paths = resolveConfigTierPaths('bot-settings.json');
    expect(paths).toEqual([]);
  });

  it('per-keyword merges across tiers, higher tier wins per key', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');

    writeJson(path.join(tmpRoot, 'zds-ai-root', 'config'), 'bot-settings.json', {
      defaultModel: 'from-defaults',
      baseURL: 'https://defaults.example',
    });
    writeJson(path.join(tmpRoot, 'project', '.zds-ai'), 'bot-settings.json', {
      defaultModel: 'from-project',
    });

    const merged = loadTieredJsonConfig<any>('bot-settings.json');
    expect(merged.defaultModel).toBe('from-project'); // project tier overrides
    expect(merged.baseURL).toBe('https://defaults.example'); // falls through from defaults
  });

  it('tier 3 is file-level: BOT_CONFIG_DIR file existing means AGENT_CONFIG_HOME is not consulted at all', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_BOT_CONFIG_DIR = path.join(tmpRoot, 'bot-config');
    process.env.ZDS_AI_AGENT_CONFIG_HOME = path.join(tmpRoot, 'agent-config');

    writeJson(path.join(tmpRoot, 'bot-config'), 'bot-settings.json', {
      defaultModel: 'from-bot-config-dir',
    });
    // agent-config-home has a DIFFERENT key that would otherwise be picked up if merged
    writeJson(path.join(tmpRoot, 'agent-config'), 'bot-settings.json', {
      defaultModel: 'from-agent-config-home',
      temperature: 0.3,
    });

    const merged = loadTieredJsonConfig<any>('bot-settings.json');
    expect(merged.defaultModel).toBe('from-bot-config-dir');
    // temperature must NOT appear -- agent-config-home's file is not read at all
    expect(merged.temperature).toBeUndefined();
  });

  it('falls back to AGENT_CONFIG_HOME only when BOT_CONFIG_DIR file does not exist', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_BOT_CONFIG_DIR = path.join(tmpRoot, 'bot-config'); // dir exists, but no file
    fs.mkdirSync(path.join(tmpRoot, 'bot-config'), { recursive: true });
    process.env.ZDS_AI_AGENT_CONFIG_HOME = path.join(tmpRoot, 'agent-config');

    writeJson(path.join(tmpRoot, 'agent-config'), 'bot-settings.json', {
      temperature: 0.9,
    });

    const merged = loadTieredJsonConfig<any>('bot-settings.json');
    expect(merged.temperature).toBe(0.9);
  });

  it('skips the PWD tier when PWD is already the project dir', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');
    fs.mkdirSync(process.env.ZDS_AI_PROJECT_DIR, { recursive: true });
    process.chdir(process.env.ZDS_AI_PROJECT_DIR);

    writeJson(path.join(tmpRoot, 'project', '.zds-ai'), 'bot-settings.json', { defaultModel: 'project-model' });

    const paths = resolveConfigTierPaths('bot-settings.json');
    // Only one occurrence of the project's .zds-ai/bot-settings.json, not counted twice
    const projectFilePath = path.join(tmpRoot, 'project', '.zds-ai', 'bot-settings.json');
    expect(paths.filter((p) => p === projectFilePath)).toHaveLength(1);
  });

  it('does NOT skip the PWD tier when PWD differs from project/task dirs', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');
    const pwdDir = path.join(tmpRoot, 'somewhere-else');
    fs.mkdirSync(pwdDir, { recursive: true });
    process.chdir(pwdDir);

    writeJson(path.join(pwdDir, '.zds-ai'), 'bot-settings.json', { defaultModel: 'pwd-model' });

    const merged = loadTieredJsonConfig<any>('bot-settings.json');
    expect(merged.defaultModel).toBe('pwd-model');
  });

  it('config-force (tier 7) wins over every other tier', () => {
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');

    writeJson(path.join(tmpRoot, 'project', '.zds-ai'), 'bot-settings.json', { defaultModel: 'project-model' });
    writeJson(path.join(tmpRoot, 'zds-ai-root', 'config-force'), 'bot-settings.json', {
      defaultModel: 'forced-model',
    });

    const merged = loadTieredJsonConfig<any>('bot-settings.json');
    expect(merged.defaultModel).toBe('forced-model');
  });
});
