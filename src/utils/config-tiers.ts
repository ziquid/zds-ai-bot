import * as fs from "fs";
import * as path from "path";

/**
 * Multi-tiered config file resolution and merging, per zds-bot MVP spec (#3/#4).
 *
 * Tiers, lowest to highest priority:
 *   1. $(ZDS_AI_ROOT)/config/<filename>                          (defaults, shipped with zds-ai)
 *   2. $(ZDS_AI_BOT_GLOBAL_CONFIG_DIR)/<filename>
 *   3. $(ZDS_AI_BOT_CONFIG_DIR)/<filename> OR $(ZDS_AI_AGENT_CONFIG_HOME)/<filename>
 *      -- FILE-LEVEL fallback: if the file exists in ZDS_AI_BOT_CONFIG_DIR, it wins outright
 *      and ZDS_AI_AGENT_CONFIG_HOME is not consulted at all for this file.  This tier is the
 *      only one that isn't a per-keyword merge with its own alternate source.
 *   4. $(ZDS_AI_PROJECT_DIR)/.zds-ai/<filename>
 *   5. $(ZDS_AI_TASK_DIR)/.zds-ai/<filename>
 *   6. $(PWD)/.zds-ai/<filename>  (skipped if PWD is already one of the dirs above, to avoid
 *      double-counting the same file at two tiers)
 *   7. $(ZDS_AI_ROOT)/config-force/<filename>                    (forced overrides, highest priority)
 *
 * All tiers other than 3's internal choice are merged per-keyword: a higher tier's key
 * overrides a lower tier's same key, but keys the higher tier doesn't set still fall through
 * from lower tiers.
 */

const DEFAULT_ZDS_AI_ROOT = "/usr/local/share/zds-ai";

function zdsAiRoot(): string {
  return process.env.ZDS_AI_ROOT || DEFAULT_ZDS_AI_ROOT;
}

/**
 * Resolve the ordered list of existing tier file paths for a given config filename,
 * lowest priority first.  Tier 3's BOT_CONFIG_DIR/AGENT_CONFIG_HOME choice is already
 * resolved to at most one path here.
 */
export function resolveConfigTierPaths(filename: string): string[] {
  const paths: string[] = [];
  const root = zdsAiRoot();

  // Tier 1: shipped defaults
  paths.push(path.join(root, "config", filename));

  // Tier 2: global bot config dir
  if (process.env.ZDS_AI_BOT_GLOBAL_CONFIG_DIR) {
    paths.push(path.join(process.env.ZDS_AI_BOT_GLOBAL_CONFIG_DIR, filename));
  }

  // Tier 3: file-level fallback between BOT_CONFIG_DIR and AGENT_CONFIG_HOME
  const botConfigDir = process.env.ZDS_AI_BOT_CONFIG_DIR;
  const agentConfigHome = process.env.ZDS_AI_AGENT_CONFIG_HOME;
  if (botConfigDir && fs.existsSync(path.join(botConfigDir, filename))) {
    paths.push(path.join(botConfigDir, filename));
  } else if (agentConfigHome && fs.existsSync(path.join(agentConfigHome, filename))) {
    paths.push(path.join(agentConfigHome, filename));
  }

  // Tier 4: project dir
  if (process.env.ZDS_AI_PROJECT_DIR) {
    paths.push(path.join(process.env.ZDS_AI_PROJECT_DIR, ".zds-ai", filename));
  }

  // Tier 5: task dir
  if (process.env.ZDS_AI_TASK_DIR) {
    paths.push(path.join(process.env.ZDS_AI_TASK_DIR, ".zds-ai", filename));
  }

  // Tier 6: PWD, only if PWD isn't already one of the dirs above
  const pwd = process.cwd();
  const alreadyCoveredDirs = [process.env.ZDS_AI_PROJECT_DIR, process.env.ZDS_AI_TASK_DIR].filter(
    (d): d is string => !!d
  );
  if (!alreadyCoveredDirs.includes(pwd)) {
    paths.push(path.join(pwd, ".zds-ai", filename));
  }

  // Tier 7: forced overrides, always highest priority
  paths.push(path.join(root, "config-force", filename));

  return paths.filter((p) => fs.existsSync(p));
}

/**
 * Load and per-keyword-merge a JSON config file across all applicable tiers.
 * Later (higher-priority) tiers overwrite matching top-level keys from earlier tiers.
 */
export function loadTieredJsonConfig<T extends Record<string, any>>(filename: string): Partial<T> {
  const tierPaths = resolveConfigTierPaths(filename);
  let merged: Partial<T> = {};

  for (const tierPath of tierPaths) {
    try {
      const content = fs.readFileSync(tierPath, "utf-8");
      if (!content.trim()) continue;
      const parsed = JSON.parse(content);
      merged = { ...merged, ...parsed };
    } catch (error) {
      console.warn(
        `Failed to load config tier ${tierPath}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return merged;
}
