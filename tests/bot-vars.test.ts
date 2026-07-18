/**
 * Unit tests for the tiered bot-vars.yml prompt variable loading (zds-bot #4)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsManager } from '../src/utils/settings-manager.js';

describe('bot-vars.yml tiered loading', () => {
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
  const manager = SettingsManager.getInstance();

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-vars-test-'));
    originalCwd = process.cwd();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
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

  function writeVars(dir: string, variables: any[]) {
    fs.mkdirSync(dir, { recursive: true });
    const body = { variables };
    fs.writeFileSync(path.join(dir, 'bot-vars.yml'), JSON.stringify(body));
  }

  it('reads the default bot-vars.yml from ZDS_AI_ROOT/config', () => {
    writeVars(path.join(tmpRoot, 'zds-ai-root', 'config'), [
      { name: 'FOO', template: 'default-foo' },
    ]);

    const defs = manager.loadVariableDefinitions();
    expect(defs.find((d) => d.name === 'FOO')?.template).toBe('default-foo');
  });

  it('concatenates variables from every tier that defines the file', () => {
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');
    writeVars(path.join(tmpRoot, 'zds-ai-root', 'config'), [{ name: 'FOO', template: 'default-foo' }]);
    writeVars(path.join(tmpRoot, 'project', '.zds-ai'), [{ name: 'BAR', template: 'project-bar' }]);

    const defs = manager.loadVariableDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual(['BAR', 'FOO']);
  });

  it('a higher tier redefining the same variable name overrides the lower tier (last-write-wins by name)', () => {
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');
    writeVars(path.join(tmpRoot, 'zds-ai-root', 'config'), [{ name: 'FOO', template: 'default-foo' }]);
    writeVars(path.join(tmpRoot, 'project', '.zds-ai'), [{ name: 'FOO', template: 'project-foo' }]);

    const defs = manager.loadVariableDefinitions();
    // Concatenated order is lowest-to-highest tier; a name-keyed consumer (see
    // prompt-variables.ts's VariableDef.definitions map) takes the LAST matching
    // entry, so the project tier's definition must appear after the default's.
    const fooEntries = defs.filter((d) => d.name === 'FOO');
    expect(fooEntries[fooEntries.length - 1].template).toBe('project-foo');
  });

  it('config-force (tier 7) vars are appended last, after project/task/pwd tiers', () => {
    process.env.ZDS_AI_PROJECT_DIR = path.join(tmpRoot, 'project');
    writeVars(path.join(tmpRoot, 'project', '.zds-ai'), [{ name: 'FOO', template: 'project-foo' }]);
    writeVars(path.join(tmpRoot, 'zds-ai-root', 'config-force'), [{ name: 'FOO', template: 'forced-foo' }]);

    const defs = manager.loadVariableDefinitions();
    const fooEntries = defs.filter((d) => d.name === 'FOO');
    expect(fooEntries[fooEntries.length - 1].template).toBe('forced-foo');
  });

  it('returns an empty array when no tier defines bot-vars.yml', () => {
    expect(manager.loadVariableDefinitions()).toEqual([]);
  });
});

describe('prompt-variables.ts PWD tier re-evaluation after chdir (zds-bot #33)', () => {
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
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-vars-chdir-test-'));
    originalCwd = process.cwd();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.ZDS_AI_ROOT = path.join(tmpRoot, 'zds-ai-root');
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

  function writeVars(dir: string, variables: any[]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bot-vars.yml'), JSON.stringify({ variables }));
  }

  it('picks up a directory-local bot-vars.yml after a real process.chdir(), not just at first load', async () => {
    const dirA = path.join(tmpRoot, 'dir-a');
    const dirB = path.join(tmpRoot, 'dir-b');
    writeVars(path.join(dirA, '.zds-ai'), [{ name: 'ZDS_BOT_33_TEST_VAR', template: 'value-from-dir-a' }]);
    writeVars(path.join(dirB, '.zds-ai'), [{ name: 'ZDS_BOT_33_TEST_VAR', template: 'value-from-dir-b' }]);

    process.chdir(dirA);
    const { VariableDef } = await import('../src/agent/prompt-variables.js');
    let defs = VariableDef.getAllDefinitions();
    expect(defs.find((d) => d.name === 'ZDS_BOT_33_TEST_VAR')?.template).toBe('value-from-dir-a');

    // Simulate the bot's `cd` tool changing directories mid-session (src/tools/zsh.ts chdir()).
    process.chdir(dirB);
    defs = VariableDef.getAllDefinitions();
    expect(defs.find((d) => d.name === 'ZDS_BOT_33_TEST_VAR')?.template).toBe('value-from-dir-b');
  });
});
