import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type LogEntry = { line: string; type: 'info' | 'success' | 'error' | 'system'; ts: number }
type LogCallback = (entry: LogEntry) => void

const api = {
  // Preferences
  getPrefs: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('get-prefs'),
  setPrefs: (data: Record<string, unknown>): Promise<boolean> => ipcRenderer.invoke('set-prefs', data),
  acceptSecurity: (): Promise<void> => ipcRenderer.invoke('security-accept'),

  // Detection
  detectOpenClaw: () => ipcRenderer.invoke('detect-openclaw'),
  checkEnvironment: () => ipcRenderer.invoke('check-environment'),

  // Installation
  runInstallStep: (step: string, packageName?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('run-install-step', step, packageName),

  // Gateway
  gatewayStatus: () => ipcRenderer.invoke('gateway-status'),
  startGateway: (execPath: string, via: 'global' | 'pnpm') =>
    ipcRenderer.invoke('start-gateway', execPath, via),
  stopGateway: (execPath: string) => ipcRenderer.invoke('stop-gateway', execPath),

  // Config
  readConfig: (): Promise<string | null> => ipcRenderer.invoke('read-config'),
  writeConfig: (content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('write-config', content),
  openConfigDir: () => ipcRenderer.invoke('open-config-dir'),

  // Skills / Memory / Chat
  listSkills: () => ipcRenderer.invoke('list-skills'),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  clearSessions: () => ipcRenderer.invoke('clear-sessions'),
  readWorkspaceFile: (filename: string) => ipcRenderer.invoke('read-workspace-file', filename),
  writeWorkspaceFile: (filename: string, content: string) => ipcRenderer.invoke('write-workspace-file', filename, content),
  runChatMessage: (execPath: string, message: string, agentId?: string, thinking?: boolean) =>
    ipcRenderer.invoke('run-chat-message', execPath, message, agentId, thinking),
  getTokenStats: () => ipcRenderer.invoke('get-token-stats'),

  // Config (new)
  getConfigObject: () => ipcRenderer.invoke('get-config-object'),
  validateConfig: (content: string) => ipcRenderer.invoke('validate-config', content),
  writeConfigValidated: (content: string, force?: boolean) => ipcRenderer.invoke('write-config-validated', content, force),
  patchConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('patch-config', patch),
  getGatewayToken: () => ipcRenderer.invoke('get-gateway-token'),
  resetGatewayToken: () => ipcRenderer.invoke('reset-gateway-token'),

  // Channels
  getChannelsConfig: () => ipcRenderer.invoke('get-channels-config'),
  saveChannelsConfig: (ch: Record<string, unknown>) => ipcRenderer.invoke('save-channels-config', ch),

  // Agents
  getAgentsConfig: () => ipcRenderer.invoke('get-agents-config'),
  saveAgentsConfig: (agents: Record<string, unknown>) => ipcRenderer.invoke('save-agents-config', agents),
  addAgentCli: (execPath: string, agentId: string) => ipcRenderer.invoke('add-agent-cli', execPath, agentId),
  listAllSessions: () => ipcRenderer.invoke('list-all-sessions'),
  clearAgentSessions: (agentId: string) => ipcRenderer.invoke('clear-agent-sessions', agentId),

  // Cron / Schedule
  getSchedule: () => ipcRenderer.invoke('get-schedule'),
  saveSchedule: (schedule: unknown[]) => ipcRenderer.invoke('save-schedule', schedule),

  // Plugins
  listPlugins: () => ipcRenderer.invoke('list-plugins'),

  // Openclaw management
  openclawManage: (action: 'update' | 'uninstall', via?: 'global' | 'pnpm', cliName?: string, execPath?: string, pnpmBinDir?: string) =>
    ipcRenderer.invoke('openclaw-manage', action, via, cliName, execPath, pnpmBinDir),
  showUninstallDialog: (packageName: string) => ipcRenderer.invoke('show-uninstall-dialog', packageName),
  submitUninstallResult: (result: { confirmed: boolean; keepData: boolean }) =>
    ipcRenderer.invoke('uninstall-dialog-result', result),
  openclawFullUninstall: (opts: { keepData: boolean; via: 'global' | 'pnpm'; cliName: string; execPath: string; pnpmBinDir: string }) =>
    ipcRenderer.invoke('openclaw-full-uninstall', opts),

  // CLI commands & utils
  checkLatestVersion: (packageName: string) => ipcRenderer.invoke('check-latest-version', packageName),
  runOpenclawCmd: (execPath: string, args: string[]) => ipcRenderer.invoke('run-openclaw-cmd', execPath, args),
  oauthLogin: (execPath: string, provider: string): Promise<{ ok: boolean; url: string | null; error?: string }> =>
    ipcRenderer.invoke('oauth-login', execPath, provider),
  onOauthUrl: (callback: (data: { url: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: { url: string }) => callback(data)
    ipcRenderer.on('oauth-url', wrapped)
    return () => ipcRenderer.removeListener('oauth-url', wrapped)
  },
  testProvider: (provider: string, apiKey: string, modelsEndpoint: string) =>
    ipcRenderer.invoke('test-provider', provider, apiKey, modelsEndpoint),
  backupConfig: () => ipcRenderer.invoke('backup-config'),
  restoreConfig: () => ipcRenderer.invoke('restore-config'),

  // Utility
  writeClipboard: (text: string) => ipcRenderer.invoke('write-clipboard', text),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Streaming events
  onLog: (callback: LogCallback) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: LogEntry) => callback(data)
    ipcRenderer.on('log', wrapped)
    return () => ipcRenderer.removeListener('log', wrapped)
  },
  onGatewayStopped: (callback: (data: { code: number | null }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: { code: number | null }) => callback(data)
    ipcRenderer.on('gateway-stopped', wrapped)
    return () => ipcRenderer.removeListener('gateway-stopped', wrapped)
  },
  onGatewayExternal: (callback: (data: { port: number }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: { port: number }) => callback(data)
    ipcRenderer.on('gateway-external', wrapped)
    return () => ipcRenderer.removeListener('gateway-external', wrapped)
  },

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  appQuit: () => ipcRenderer.invoke('app-quit'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
