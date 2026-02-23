import type { MenuEvent, DialogOptions, AppSettings, RecentProject } from '@/types/electron';

/**
 * Thin wrapper around the preload-exposed window.electronAPI.
 * Every method gracefully degrades when running outside Electron (plain browser).
 */
export class ElectronService {
  private get api() {
    return typeof window !== 'undefined' ? window.electronAPI : undefined;
  }

  // ── Detect environment ──
  isElectron(): boolean {
    return !!this.api;
  }

  // ── App info ──
  async getAppVersion(): Promise<string> {
    return this.api?.getAppVersion?.() ?? '1.0.0';
  }

  async getPlatform(): Promise<string> {
    return this.api?.getPlatform?.() ?? 'unknown';
  }

  // ── File operations ──
  async readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.readFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.writeFile(filePath, content);
  }

  async readDirectory(dirPath: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.readDirectory(dirPath);
  }

  async getFileStats(filePath: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.getFileStats(filePath);
  }

  async createDirectory(dirPath: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.createDirectory(dirPath);
  }

  async deleteFile(filePath: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.deleteFile(filePath);
  }

  async deleteDirectory(dirPath: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.deleteDirectory(dirPath);
  }

  async copyFile(src: string, dest: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.copyFile(src, dest);
  }

  async moveFile(src: string, dest: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.moveFile(src, dest);
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (!this.api) return false;
    const result = await this.api.fileExists(filePath);
    return result.exists ?? false;
  }

  // ── Dialog operations ──
  async showSaveDialog(options: DialogOptions): Promise<{ canceled: boolean; filePath?: string }> {
    if (!this.api) return { canceled: true };
    return this.api.showSaveDialog(options);
  }

  async showOpenDialog(options: DialogOptions): Promise<{ canceled: boolean; filePaths?: string[] }> {
    if (!this.api) return { canceled: true };
    return this.api.showOpenDialog(options);
  }

  async showMessageBox(options: {
    type?: string; buttons?: string[]; defaultId?: number;
    title?: string; message?: string; detail?: string;
  }): Promise<{ response: number }> {
    if (!this.api) return { response: 0 };
    return this.api.showMessageBox(options);
  }

  // ── External links ──
  async openExternal(url: string) {
    if (!this.api) return { success: false, error: 'Electron API not available' };
    return this.api.openExternal(url);
  }

  // ── Menu event listeners ──
  onMenuEvent(callback: (event: MenuEvent) => void): void {
    if (!this.api) return;

    const wire = (
      register: ((cb: (event: any, ...args: any[]) => void) => void) | undefined,
      type: MenuEvent['type']
    ) => {
      register?.((_, data) => callback({ type, data }));
    };

    wire(this.api.onMenuNewProject, 'new-project');
    wire(this.api.onMenuOpenProject, 'open-project');
    wire(this.api.onMenuSaveFile, 'save-file');
    wire(this.api.onMenuSave, 'save-file');
    wire(this.api.onMenuSaveAll, 'save-all');
    wire(this.api.onMenuToggleExplorer, 'toggle-explorer');
    wire(this.api.onMenuToggleChat, 'toggle-chat');
    wire(this.api.onMenuToggleTasks, 'toggle-tasks');
    wire(this.api.onMenuFontSizeIncrease, 'font-size-increase');
    wire(this.api.onMenuFontSizeDecrease, 'font-size-decrease');
    wire(this.api.onMenuFontSizeReset, 'font-size-reset');
    wire(this.api.onMenuRunTask, 'run-task');
    wire(this.api.onMenuDebug, 'debug');
    wire(this.api.onMenuSettings, 'settings');
  }

  onAppQuit(callback: () => void): void {
    window.addEventListener('beforeunload', callback);
  }

  // ── Settings persistence (stored as JSON files via Electron FS) ──
  async getSettings(): Promise<AppSettings> {
    const defaults: AppSettings = {
      theme: 'dark', fontSize: 14,
      fontFamily: 'Consolas, Monaco, monospace',
      tabSize: 2, wordWrap: true, autoSave: true,
      autoSaveInterval: 30000, showMinimap: true,
      showLineNumbers: true, renderWhitespace: 'boundary',
    };
    try {
      const result = await this.readFile('settings.json');
      if (result.success && result.content) return { ...defaults, ...JSON.parse(result.content) };
    } catch { /* use defaults */ }
    return defaults;
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<boolean> {
    try {
      const current = await this.getSettings();
      await this.writeFile('settings.json', JSON.stringify({ ...current, ...settings }, null, 2));
      return true;
    } catch { return false; }
  }

  // ── Recent projects ──
  async getRecentProjects(): Promise<RecentProject[]> {
    try {
      const r = await this.readFile('recent-projects.json');
      if (r.success && r.content) {
        return JSON.parse(r.content).map((p: any) => ({ ...p, lastOpened: new Date(p.lastOpened) }));
      }
    } catch { /* empty */ }
    return [];
  }

  async addRecentProject(project: Omit<RecentProject, 'lastOpened'>): Promise<boolean> {
    try {
      const projects = await this.getRecentProjects();
      const updated = [{ ...project, lastOpened: new Date() }, ...projects.filter(p => p.path !== project.path)].slice(0, 10);
      await this.writeFile('recent-projects.json', JSON.stringify(updated, null, 2));
      return true;
    } catch { return false; }
  }
}

// Singleton instance
export const electronService = new ElectronService();
