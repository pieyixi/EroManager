// 阅读器保留原有 fullscreen 状态机；隐私锁只请求它退出，不能绕过最大化恢复边界。
let exitReader: (() => Promise<void>) | undefined;
export function registerReaderPrivacyExit(handler?: () => Promise<void>): void { exitReader = handler; }
export async function exitReaderForPrivacy(): Promise<void> { await exitReader?.(); }
