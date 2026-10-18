import { nextTick, onScopeDispose, watch, type Ref } from 'vue';

interface InputPad { focus(): void; handleKey(event: KeyboardEvent): void }
/** 只接管当前解锁帘的输入；不注册系统热键，也不打断顶层原生 dialog。 */
export function useAccountGateInput(visible: Ref<boolean>, pad: Ref<InputPad | null>) {
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const dialogActive = () => document.activeElement instanceof HTMLElement && !!document.activeElement.closest('dialog[open]');
  function focus(): void { if (visible.value && !dialogActive()) pad.value?.focus(); }
  function keydown(event: KeyboardEvent): void { if (visible.value && !dialogActive()) pad.value?.handleKey(event); }
  function pointerdown(event: PointerEvent): void {
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,a,[role=menuitem]')) return;
    clearTimeout(focusTimer); focusTimer = setTimeout(focus, 0);
  }
  const stop = watch(visible, async open => {
    document.removeEventListener('keydown', keydown, true); window.removeEventListener('focus', focus);
    if (open) { document.addEventListener('keydown', keydown, true); window.addEventListener('focus', focus); await nextTick(); focus(); }
    else clearTimeout(focusTimer);
  }, { immediate: true });
  onScopeDispose(() => { stop(); clearTimeout(focusTimer); document.removeEventListener('keydown', keydown, true); window.removeEventListener('focus', focus); });
  return { pointerdown };
}
