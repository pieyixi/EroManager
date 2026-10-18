// 请求在发起时捕获作用域；旧账号的异步任务不得改写新账号。
let scope = '';
let knownPin = '';
export const accountScope = () => scope;
export function setAccountScope(value: string): void { if (scope !== value) knownPin = ''; scope = value; }
// 仅记住当前已验证会话中输入/设置过的密码以供账号行显示，不写本地存储或回传密码。
export const accountPin = () => scope ? knownPin : '';
export function rememberAccountPin(value: string, owner = scope): void {
  if (owner && owner === scope) knownPin = /^\d{4}$/.test(value) ? value : '';
}
const pending = new Set<Promise<unknown>>();
export function trackAccountWrite<T>(request: Promise<T>): Promise<T> {
  pending.add(request);
  void request.finally(() => pending.delete(request)).catch(() => undefined);
  return request;
}
export async function flushAccountWrites(): Promise<void> { while (pending.size) await Promise.all([...pending]); }
