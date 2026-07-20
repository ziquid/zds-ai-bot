import * as fs from "fs";
import * as yaml from "js-yaml";
import { loadTieredJsonConfig, resolveConfigTierPaths } from "./config-tiers.js";

/**
 * Unified bot settings, merged per-keyword across all config tiers (see config-tiers.ts).
 * Replaces the old UserSettings/ProjectSettings split -- project-dir vs. user-dir is now
 * just two of the seven tiers in the same merge, not two separately-shaped objects.
 */
export interface BotSettings {
  apiKey?: string; // Grok API key
  baseURL?: string; // API base URL
  defaultModel?: string; // User's preferred default model
  model?: string; // Current/project model override
  temperature?: number; // Default temperature for API requests (0.0-2.0, default: 0.7)
  maxTokens?: number; // Default max tokens for API responses (no upper limit, default: undefined = API default)
  instanceHook?: string; // Command to run for every instance (new and resumed sessions), output parsed for commands
  postUserInputHook?: string; // Command to run after each user input is received
  preLLMResponseHook?: string; // Command to run before each prompt is sent to the LLM
  postLLMResponseHook?: string; // Command to run after each prompt is sent to the LLM
  preToolCallHook?: string; // Command to run before each approved tool call is executed
  postToolCallHook?: string; // Command to run after each approved tool call is executed
  taskApprovalHook?: string; // Command to validate task operations (start/transition/stop)
  toolApprovalHook?: string; // Command to validate tool execution before running
  personaHook?: string; // Command to validate persona changes
  personaHookMandatory?: boolean; // Whether persona hook is required
  moodHook?: string; // Command to validate mood changes
  moodHookMandatory?: boolean; // Whether mood hook is required
  contextViewHelper?: string; // Helper for viewing context in text mode (default: $PAGER or less)
  contextViewHelperGui?: string; // Helper for viewing context in GUI mode (default: open on macOS, xdg-open on Linux)
  contextEditHelper?: string; // Helper for editing context in text mode (default: $EDITOR or nano)
  contextEditHelperGui?: string; // Helper for editing context in GUI mode (default: open -e on macOS, xdg-open on Linux)
  mcpServers?: Record<string, any>; // MCP server configurations (merged in from bot-mcp.json tiers)
  mcpToolDenylist?: string[]; // List of MCP tool names to exclude from the LLM tool list
}

// Kept as aliases so existing call sites importing UserSettings/ProjectSettings keep working.
export type UserSettings = BotSettings;
export type ProjectSettings = BotSettings;

const SETTINGS_FILENAME = "bot-settings.json";
const MCP_FILENAME = "bot-mcp.json";

/**
 * Defaults for bot settings, merged in below every tier (i.e. the true "tier 0" floor).
 */
const DEFAULT_SETTINGS: Partial<BotSettings> = {
  baseURL: "https://api.x.ai/v1", // Grok default
  defaultModel: "grok-4.3",
  model: "grok-4.3",
};

/**
 * Unified settings manager backed by the multi-tiered config system (see config-tiers.ts):
 * defaults -> global -> bot/agent config dir (file-level) -> project -> task -> pwd -> config-force.
 */
export class SettingsManager {
  private static instance: SettingsManager;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Load the fully tier-merged bot settings, including mcpServers merged in from the
   * bot-mcp.json tiers.
   */
  public loadSettings(): BotSettings {
    const settings = loadTieredJsonConfig<BotSettings>(SETTINGS_FILENAME);
    const mcpConfig = loadTieredJsonConfig<{ mcpServers?: Record<string, any> }>(MCP_FILENAME);

    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      mcpServers: mcpConfig.mcpServers,
    };
  }

  /**
   * Kept for existing call sites -- returns the same tier-merged settings as loadSettings().
   * There is no longer a separate "user" vs "project" settings shape; project/task/pwd dirs
   * are just tiers in the same merge.
   */
  public loadUserSettings(): BotSettings {
    return this.loadSettings();
  }

  /**
   * Kept for existing call sites -- returns the same tier-merged settings as loadSettings().
   */
  public loadProjectSettings(): BotSettings {
    return this.loadSettings();
  }

  /**
   * Get a specific setting from the fully tier-merged settings
   */
  public getUserSetting<K extends keyof BotSettings>(key: K): BotSettings[K] {
    return this.loadSettings()[key];
  }

  /**
   * Get a specific setting from the fully tier-merged settings (alias of getUserSetting --
   * there's no longer a distinct project-only view, project dir is just a tier)
   */
  public getProjectSetting<K extends keyof BotSettings>(key: K): BotSettings[K] {
    return this.loadSettings()[key];
  }

  /**
   * Get the current model with proper fallback logic:
   * 1.  Configured model (any tier; project/task/pwd tiers naturally take precedence via merge order)
   * 2.  User's default model
   * 3.  System default
   */
  public getCurrentModel(): string {
    const settings = this.loadSettings();
    if (settings.model) {
      return settings.model;
    }

    if (settings.defaultModel) {
      return settings.defaultModel;
    }

    return DEFAULT_SETTINGS.model || "grok-4.3";
  }

  /**
   * Get API key from settings or environment
   */
  public getApiKey(): string | undefined {
    // First check environment variable
    const envApiKey = process.env.GROK_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }

    // Then check tiered settings
    return this.getUserSetting("apiKey");
  }

  /**
   * Get instance hook command from user settings
   */
  public getInstanceHook(): string | undefined {
    return this.getUserSetting("instanceHook");
  }

  /**
   * Get task approval hook command from settings
   * Used for validating all task operations (start/transition/stop)
   */
  public getTaskApprovalHook(): string | undefined {
    return this.getUserSetting("taskApprovalHook");
  }

  /**
   * Get tool approval hook command from settings
   */
  public getToolApprovalHook(): string | undefined {
    return this.getUserSetting("toolApprovalHook");
  }

  /**
   * Get persona hook command from settings
   */
  public getPersonaHook(): string | undefined {
    return this.getUserSetting("personaHook");
  }

  /**
   * Check if persona hook is mandatory
   */
  public isPersonaHookMandatory(): boolean {
    return this.getUserSetting("personaHookMandatory") ?? false;
  }

  /**
   * Get mood hook command from settings
   */
  public getMoodHook(): string | undefined {
    return this.getUserSetting("moodHook");
  }

  /**
   * Check if mood hook is mandatory
   */
  public isMoodHookMandatory(): boolean {
    return this.getUserSetting("moodHookMandatory") ?? false;
  }

  /**
   * Get postUserInput hook command from settings
   */
  public getPostUserInputHook(): string | undefined {
    return this.getUserSetting("postUserInputHook");
  }

  /**
   * Get preLLMResponse hook command from settings
   */
  public getPreLLMResponseHook(): string | undefined {
    return this.getUserSetting("preLLMResponseHook");
  }

  /**
   * Get postLLMResponse hook command from settings
   */
  public getPostLLMResponseHook(): string | undefined {
    return this.getUserSetting("postLLMResponseHook");
  }

  /**
   * Get preToolCall hook command from settings
   */
  public getPreToolCallHook(): string | undefined {
    return this.getUserSetting("preToolCallHook");
  }

  /**
   * Get postToolCall hook command from settings
   */
  public getPostToolCallHook(): string | undefined {
    return this.getUserSetting("postToolCallHook");
  }

  /**
   * Detect if we're running in a GUI environment or text-only (SSH/terminal)
   * Returns true if GUI is available, false for text-only
   */
  public isGuiAvailable(): boolean {
    // Check if SSH session
    if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
      return false;
    }

    // Check platform-specific GUI indicators
    if (process.platform === "darwin") {
      // macOS: Check if we have GUI session (not ssh, not screen/tmux)
      return !process.env.STY && !process.env.TMUX;
    } else if (process.platform === "linux") {
      // Linux: Check for X11 or Wayland display
      return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    } else if (process.platform === "win32") {
      // Windows: Assume GUI available unless in WSL SSH
      return true;
    }

    // Default to text-only if uncertain
    return false;
  }

  /**
   * Get context view helper command from settings
   * Auto-detects GUI vs text-only environment
   */
  public getContextViewHelper(): string {
    const isGui = this.isGuiAvailable();

    if (isGui) {
      // GUI mode
      const guiHelper = this.getUserSetting("contextViewHelperGui");
      if (guiHelper) {
        return guiHelper;
      }

      // Platform-specific GUI defaults
      if (process.platform === "darwin") {
        return "open"; // macOS: open in default app
      } else if (process.platform === "linux") {
        return "xdg-open"; // Linux: open in default app
      } else if (process.platform === "win32") {
        return "start"; // Windows: open in default app
      }
    }

    // Text mode
    const textHelper = this.getUserSetting("contextViewHelper");
    if (textHelper) {
      return textHelper;
    }

    // Fall back to environment variable
    const pager = process.env.PAGER;
    if (pager) {
      return pager;
    }

    // Fall back to common pagers
    return "less -R"; // -R for color support
  }

  /**
   * Get context edit helper command from settings
   * Auto-detects GUI vs text-only environment
   */
  public getContextEditHelper(): string {
    const isGui = this.isGuiAvailable();

    if (isGui) {
      // GUI mode
      const guiHelper = this.getUserSetting("contextEditHelperGui");
      if (guiHelper) {
        return guiHelper;
      }

      // Platform-specific GUI defaults
      if (process.platform === "darwin") {
        return "open -e"; // macOS: open in TextEdit
      } else if (process.platform === "linux") {
        return "xdg-open"; // Linux: open in default editor
      } else if (process.platform === "win32") {
        return "notepad"; // Windows: Notepad
      }
    }

    // Text mode
    const textHelper = this.getUserSetting("contextEditHelper");
    if (textHelper) {
      return textHelper;
    }

    // Fall back to environment variables
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (editor) {
      return editor;
    }

    // Fall back to common editors
    return "nano";
  }

  /**
   * Get base URL from settings or environment
   */
  public getBaseURL(): string {
    // First check environment variable
    const envBaseURL = process.env.GROK_BASE_URL;
    if (envBaseURL) {
      return envBaseURL;
    }

    // Then check settings, then use default
    const userBaseURL = this.getUserSetting("baseURL");
    return userBaseURL || DEFAULT_SETTINGS.baseURL || "https://api.x.ai/v1";
  }

  /**
   * Get temperature from settings
   * Defaults to 0.7 if not set
   */
  public getTemperature(): number {
    const temperature = this.getUserSetting("temperature");
    if (temperature !== undefined && temperature >= 0 && temperature <= 2) {
      return temperature;
    }
    return 0.7; // Default temperature
  }

  /**
   * Get max tokens from settings or environment
   * Priority: settings > ZDS_AI_AGENT_MAX_TOKENS env var > undefined
   * Returns undefined if not set (allows API to use its default)
   */
  public getMaxTokens(): number | undefined {
    // First check settings
    const settingsMaxTokens = this.getUserSetting("maxTokens");
    if (settingsMaxTokens !== undefined && Number.isInteger(settingsMaxTokens) && settingsMaxTokens > 0) {
      return settingsMaxTokens;
    }

    // Then check environment variable (set by hooks)
    const envMaxTokens = process.env.ZDS_AI_AGENT_MAX_TOKENS;
    if (envMaxTokens) {
      const parsed = parseInt(envMaxTokens);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return undefined; // No default - let API decide
  }

  /**
   * Load variable definitions from the tiered bot-vars.yml (see ticket #4).  Each tier's
   * variables array is concatenated (later tiers appended after earlier ones); prompt-variables.ts
   * is responsible for resolving duplicate names by first-match-wins or similar, matching the
   * existing single-file behavior when only one tier defines the file.
   */
  public loadVariableDefinitions(): any[] {
    const tierPaths = resolveVarsTierPaths();
    const allVariables: any[] = [];

    for (const tierPath of tierPaths) {
      try {
        const fileContents = fs.readFileSync(tierPath, "utf8");
        const data = yaml.load(fileContents) as { variables: any[] };

        if (!data || !Array.isArray(data.variables)) {
          console.error(`Invalid bot-vars.yml format in ${tierPath}: expected { variables: [...] }`);
          continue;
        }

        allVariables.push(...data.variables);
      } catch (error) {
        console.error(`Error loading ${tierPath}: ${error}`);
      }
    }

    return allVariables;
  }
}

const VARS_FILENAME = "bot-vars.yml";

function resolveVarsTierPaths(): string[] {
  // bot-vars.yml uses the same tier resolution as bot-settings.json/bot-mcp.json (#4).
  return resolveConfigTierPaths(VARS_FILENAME);
}

/**
 * Convenience function to get the singleton instance
 */
export function getSettingsManager(): SettingsManager {
  return SettingsManager.getInstance();
}
