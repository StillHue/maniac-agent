export { runEngine } from './engine';
export type { EngineRunOptions, PermissionPromptDecision } from './engine';
export { defaultHarness } from './harness';
export type { AgentHarness } from './harness';
export { callOpenCode, getActiveProvider, setActiveProvider, getProviderHistory } from './opencode';
export type { CompletionResult, NativeToolCall } from './openai-tools';
export {
  buildOpenAITools,
  nativeArgsToCommand,
  resolveToolCallsFromCompletion,
} from './openai-tools';
export { loadManiacConfig, saveManiacConfig, fetchModels, PROVIDER_DEFS, AUTO_SLOTS, getConfiguredProviders, hasUsableProvider, upsertRegisteredSlot, getRegisteredAutoSlots } from './config';
export type { ManiacConfig, ProviderDef, AutoRouterSlot } from './config';
export { registerHook, unregisterHook, listHooks } from './hooks';
export type { HookPhase, HookContext, HookFn } from './hooks';
export * from './permissions';
export * from './session';
export * from './prompt-queue';
export * from './tool-registry';
export * from './tools';
export * from './router';
export * from './memory';
export * from './skills';
export * from './review';
export * from './compressor';
export * from './delegation';
export * from './curator';
export * from './proactive';
export * from './immortality';
export * from './server';
export * from './tool-catalog';
export { describeImage, describeImages, buildVisionAugmentedMessage, isImagePath, visionAvailable, getVisionModelLabel, IMAGE_EXTENSIONS } from './vision';
export type { ImageDescription } from './vision';
export {
  speakText,
  synthesizeSpeech,
  stripForSpeech,
  voiceAvailable,
  getElevenLabsApiKey,
  DEFAULT_ELEVEN_VOICE_ID,
} from './voice';
export {
  parseProviderIntent,
  applyProviderSwitch,
  hydrateProviderCall,
  DEFAULT_MODELS,
  PROVIDER_ENV_KEY,
} from './provider-switch';
export { toolHttpRequest } from './http/tools-http';
export { assertSafeUrl, isBlockedIp } from './http/ssrf';
export { runTelegramBot, stopTelegramBot, listKnownChats, isAllowlisted, loadAllowlist } from './telegram';
export * from './autonomy';
export * from './proposals';
export { tryAutoResume, resumeFromCheckpoint, tryDetectResume, toolFingerprint } from './resume';
export { acquireRunLock, releaseRunLock, readRunLock } from './run-lock';
export { runPool } from './concurrency';
export {
  runSentinelReview,
  parseSentinelArg,
  SENTINEL_MODEL,
  SENTINEL_PROVIDER,
} from './sentinel';
export type { SentinelScope, SentinelRunOptions } from './sentinel';
export { chatWithProvider } from './opencode';
export {
  loadMcpConfig,
  saveMcpConfig,
  getMcpConfigPath,
  connectMcpServer,
  disconnectMcpServer,
  connectAllMcpServers,
  disconnectAllMcpServers,
  callMcpTool,
  listMcpTools,
  getMcpServerStatus,
  findMcpTool,
  addMcpServer,
  removeMcpServer,
  toggleMcpServer,
} from './mcp';
export type { McpServerConfig, McpConfig, McpServerState, McpToolInfo } from './mcp';
export {
  loadPluginsConfig,
  savePluginsConfig,
  listPlugins,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  searchPlugins,
} from './plugins';
export type { PluginMeta, PluginEntry, PluginsConfig } from './plugins';
export {
  startAcpServer,
  stopAcpServer,
  isAcpRunning,
  getAcpStatus,
} from './acp';
export type { JsonRpcRequest, JsonRpcResponse, AcpServerOptions } from './acp';
export {
  sandboxExec,
  configureSandbox,
  getSandboxConfig,
  handleSandboxTool,
  sandboxTool,
} from './sandbox';
export type { SandboxConfig, SandboxResult } from './sandbox';
