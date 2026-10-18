<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useAccountsStore } from '../../stores/accounts';
import { enterAccount } from '../../features/accounts/controller';
import StartupBrand from '../shared/StartupBrand.vue';
import WindowControls from '../shared/WindowControls.vue';
import { useShellWindowControls } from '../../features/shell/useShellWindowControls';
import type { AccountInfo } from '../../api/contracts/accounts';
import PinUnlock from './PinUnlock.vue';
import { useAccountGateLayout } from '../../features/accounts/useAccountGateLayout';
import { useAccountGateInput } from '../../features/accounts/useAccountGateInput';

const accounts = useAccountsStore();
const emit = defineEmits<{ visibility: [held: boolean] }>();
const controls = useShellWindowControls();
const visible = computed(() => accounts.initialized && (accounts.locked || accounts.selecting || accounts.switching));
const selected = ref<AccountInfo | null>(null), idMode = ref(false);
const pinPad = ref<InstanceType<typeof PinUnlock> | null>(null);
const brand = ref<HTMLElement | null>(null), content = ref<HTMLElement | null>(null);
const unlockView = ref<HTMLElement | null>(null), choicesView = ref<HTMLElement | null>(null);
const mode = computed(() => idMode.value ? 'id' : selected.value ? 'pin' : 'list');
const activePad = computed(() => mode.value === 'list' ? null : pinPad.value);
const gateInput = useAccountGateInput(visible, activePad);
const systemError = computed(() => /账号不可用或 PIN 不正确|尝试过多/.test(accounts.error) ? '' : accounts.error);
useAccountGateLayout({ mode, visible, brand, content, views: [unlockView, choicesView] });
watch(mode, value => { if (value !== 'list') pinPad.value?.reset(); });
watch(visible, async open => {
  if (!open) { selected.value = null; idMode.value = false; return; }
  emit('visibility', true);
  selected.value = accounts.locked && !accounts.selecting && accounts.current?.has_pin ? accounts.current : null;
  idMode.value = false;
  await nextTick(); pinPad.value?.focus();
}, { immediate: true });
async function pick(account: AccountInfo): Promise<void> {
  accounts.error = '';
  if (!account.has_pin) await login(account.id);
  else { selected.value = account; await nextTick(); pinPad.value?.focus(); }
}
async function login(loginId: string, pin = ''): Promise<boolean> {
  await enterAccount(loginId, pin, () => pinPad.value?.finish() || Promise.resolve());
  return !accounts.error;
}
async function submit(value: string): Promise<boolean> {
  if (!idMode.value) return selected.value ? login(selected.value.id, value) : false;
  const account = accounts.accounts.find(entry => entry.id === value);
  if (!account?.has_pin) return login(value);
  accounts.error = ''; selected.value = account; idMode.value = false; return true;
}
function useId(): void { idMode.value = true; selected.value = null; accounts.error = ''; }
function chooseAnother(): void { selected.value = null; idMode.value = false; accounts.selecting = true; accounts.error = ''; }
onBeforeUnmount(() => emit('visibility', false));
</script>

<template>
  <Transition name="account-curtain" @after-leave="emit('visibility', false)">
    <section v-if="visible" class="account-curtain" role="dialog" aria-modal="true" :aria-label="accounts.locked ? '隐私锁' : '切换账号'" @pointerdown="gateInput.pointerdown" @keydown.esc.stop.prevent="!accounts.locked && !accounts.busy && (accounts.selecting = false)">
      <header class="account-chrome" data-tauri-drag-region><WindowControls :maximized="controls.maximized.value" @minimize="controls.minimizeWindow" @toggle-maximize="controls.toggleMaximize" @close="controls.closeWindow" /></header>
      <div class="account-panel" :class="{ 'account-compact-view': mode === 'list' }">
        <div class="account-brand-slot"><div ref="brand" class="account-brand-visual"><StartupBrand class="account-brand" /></div></div>
        <div ref="content" class="account-content-slot">
          <div ref="unlockView" class="account-view account-unlock" :class="{ 'is-active': mode !== 'list' }" :inert="mode === 'list'" :aria-hidden="mode === 'list'">
            <PinUnlock ref="pinPad" :mode="idMode ? 'id' : 'pin'" :animate-intro="false" :verify="submit" :disabled="accounts.busy || mode === 'list'" :error="accounts.error" />
            <button class="account-text-button" :disabled="accounts.busy" @click="chooseAnother">选择其他账号</button>
          </div>
          <div ref="choicesView" class="account-view account-choices" :class="{ 'is-active': mode === 'list' }" :inert="mode !== 'list'" :aria-hidden="mode !== 'list'">
            <h2>选择账号</h2>
            <div class="account-list"><button v-for="account in accounts.accounts" :key="account.key" class="account-choice" :aria-label="`进入 ${account.nickname} ${account.id}`" :disabled="accounts.busy" @click="pick(account)"><span class="account-face"><img v-if="account.avatar" :src="account.avatar" alt=""><span v-else>裏</span></span><span class="account-choice-label"><strong>{{ account.nickname }}</strong><small>ID {{ account.id }}</small></span><svg v-if="account.has_pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="已设 PIN"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></button></div>
            <button class="account-text-button" :disabled="accounts.busy" @click="useId">使用 ID 进入</button>
          </div>
        <button v-if="!accounts.locked" class="account-text-button" :disabled="accounts.busy" @click="accounts.selecting = false">返回当前账号</button>
        <p v-if="systemError" class="account-error" role="alert">{{ systemError }}</p>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.account-curtain{position:fixed;inset:0;z-index:18000;display:grid;place-items:center;background:#fcfcfc;color:var(--text);overflow:auto;padding:78px 24px 30px}
:root[data-theme="dark"] .account-curtain{background:#16181d}
.account-chrome{position:absolute;inset:0 0 auto;display:flex;justify-content:flex-end;align-items:center;height:64px;padding-right:12px}
.account-panel{--brand-size:min(380px,calc(100vw - 48px));--brand-scale:1;--brand-gap:16px;width:min(100%,440px);text-align:center}
.account-compact-view{--brand-scale:.6315789474;--brand-gap:36px}
.account-brand-slot{display:flex;justify-content:center;height:calc(var(--brand-size) * 290 / 380 * var(--brand-scale));margin-bottom:var(--brand-gap)}
.account-brand-visual{width:var(--brand-size);height:calc(var(--brand-size) * 290 / 380);flex-shrink:0;transform:scale(var(--brand-scale));transform-origin:top center}
.account-brand{display:block;width:100%;height:100%}.account-content-slot{position:relative}
.account-panel h2{font-size:17px;color:var(--text-strong);margin:0 0 22px}
.account-list{display:flex;flex-direction:column;gap:10px;max-height:300px;overflow:auto;padding:3px}
.account-choice{display:flex;align-items:center;gap:14px;width:100%;min-height:82px;border:1px solid var(--line);border-radius:14px;background:var(--subtle-bg);color:var(--text);padding:12px 18px;text-align:left;cursor:pointer;transition:border-color .2s,background .2s,transform .2s}
.account-choice:hover{border-color:var(--primary);transform:translateY(-1px)}
.account-face{display:grid;place-items:center;width:52px;height:52px;flex-shrink:0;border-radius:50%;background:var(--panel);color:var(--primary);font:28px serif;overflow:hidden}
.account-face img{width:100%;height:100%;object-fit:cover}.account-choice-label{display:flex;min-width:0;flex:1;flex-direction:column;gap:6px}
.account-choice-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-choice small{font-size:12px;color:var(--muted)}.account-choice svg{width:20px;height:20px;color:var(--muted)}
.account-unlock{min-height:128px}.account-unlock .account-text-button{margin-top:18px}
.account-text-button{border:0;background:transparent;color:var(--muted);font-size:12px;padding:12px;cursor:pointer}.account-text-button:hover{color:var(--primary)}
.account-error{position:absolute;top:100%;left:0;right:0;margin:8px 0;color:#ed566b;font-size:12px;overflow-wrap:anywhere}
.account-curtain-enter-active,.account-curtain-leave-active{transition:opacity .32s ease,transform .32s cubic-bezier(.22,.8,.28,1)}
.account-curtain-enter-from,.account-curtain-leave-to{opacity:0;transform:translateY(5px)}
.account-view{position:absolute;inset:0 0 auto;opacity:0;pointer-events:none}.account-view.is-active{position:relative;opacity:1;pointer-events:auto}
</style>
