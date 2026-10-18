<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import SettingRow from './SettingRow.vue';
import { accountApi } from '../../api/commands/accounts';
import { accountPin, accountScope } from '../../api/accountContext';
import { useAccountsStore } from '../../stores/accounts';
import { useProfileStore } from '../../stores/profile';
import { useNavigationStore } from '../../stores/navigation';

const accounts = useAccountsStore(), profile = useProfileStore(), navigation = useNavigationStore();
const enabled = ref(profile.hasPin), editing = ref(false), busy = ref(false), savedPin = ref(accountPin());
const digits = ref(['', '', '', '']), note = ref(''), error = ref('');
const row = ref<HTMLFormElement | null>(null), fields = ref<HTMLInputElement[]>([]);
let noticeTimer: ReturnType<typeof setTimeout> | undefined, alive = true;
function clearNotice(): void { clearTimeout(noticeTimer); note.value = ''; }
function reset(): void {
  clearNotice(); editing.value = false; digits.value = ['', '', '', '']; error.value = '';
  enabled.value = profile.hasPin; savedPin.value = accounts.locked ? '' : accountPin();
}
watch(() => [profile.key, accounts.locked, navigation.activePage], reset);
watch(() => profile.hasPin, () => { if (!busy.value) reset(); }, { flush: 'sync' });
async function focus(index: number): Promise<void> { await nextTick(); if (editing.value && !busy.value) fields.value[index]?.focus(); }
function cancel(): void {
  if (busy.value) return;
  editing.value = false; digits.value = ['', '', '', '']; enabled.value = profile.hasPin; error.value = ''; clearNotice();
  fields.value.forEach(field => field.blur());
}
async function startEdit(): Promise<void> {
  if (busy.value) return;
  clearNotice(); error.value = ''; digits.value = ['', '', '', '']; editing.value = true; await focus(0);
}
function outside(event: PointerEvent): void {
  if (navigation.activePage === 'page-settings' && !accounts.locked && !accounts.selecting && !row.value?.contains(event.target as Node)) cancel();
}
watch(editing, value => {
  document.removeEventListener('pointerdown', outside, true);
  if (value) document.addEventListener('pointerdown', outside, true);
});
onBeforeUnmount(() => { alive = false; clearNotice(); document.removeEventListener('pointerdown', outside, true); });
async function persist(value: string): Promise<void> {
  if (busy.value) return;
  const owner = profile.key, scope = accountScope(); busy.value = true; error.value = ''; clearNotice();
  try {
    await accountApi.pin(value);
    // 旧账号返回的保存结果不得覆盖当前账号；后端成功后才切成只读数字。
    if (owner !== profile.key || scope !== accountScope()) return;
    profile.hasPin = !!value;
    if (accounts.current?.key === owner) accounts.current.has_pin = !!value;
    const entry = accounts.accounts.find(item => item.key === owner); if (entry) entry.has_pin = !!value;
    if (!alive) return;
    savedPin.value = accounts.locked ? '' : value; enabled.value = !!value; editing.value = false; digits.value = ['', '', '', ''];
    fields.value.forEach(field => field.blur());
    if (value && !accounts.locked && navigation.activePage === 'page-settings') {
      note.value = '已保存'; noticeTimer = setTimeout(() => { note.value = ''; }, 1400);
    }
  } catch (failure) {
    if (alive && owner === profile.key && scope === accountScope()) { error.value = `密码未保存：${String(failure)}`; enabled.value = profile.hasPin || editing.value; }
  } finally { busy.value = false; }
}
async function toggle(event: Event): Promise<void> {
  enabled.value = (event.target as HTMLInputElement).checked;
  if (enabled.value) await startEdit();
  else {
    editing.value = false; digits.value = ['', '', '', '']; clearNotice(); error.value = '';
    if (profile.hasPin) await persist('');
  }
}
async function save(): Promise<void> { if (editing.value && digits.value.every(value => /^\d$/.test(value))) await persist(digits.value.join('')); }
function type(index: number, event: Event): void {
  const field = event.target as HTMLInputElement;
  digits.value[index] = field.value.replace(/\D/g, '').slice(-1); field.value = digits.value[index] || ''; error.value = '';
  if (digits.value.every(Boolean)) void save();
  else if (digits.value[index] && index < 3) void focus(index + 1);
}
function key(index: number, event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) { event.preventDefault(); digits.value[index - 1] = ''; void focus(index - 1); }
  if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); void focus(index - 1); }
  if (event.key === 'ArrowRight' && index < 3) { event.preventDefault(); void focus(index + 1); }
}
function paste(event: ClipboardEvent): void {
  event.preventDefault(); const text = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
  if (!text) return;
  digits.value = Array.from({ length: 4 }, (_, index) => text[index] || ''); error.value = '';
  if (text.length === 4) void save(); else void focus(text.length);
}
</script>
<template>
  <SettingRow title="" class="account-password-row">
    <form ref="row" class="account-pin-control" :aria-busy="busy" novalidate @submit.prevent="save">
      <label class="account-pin-label">
        <input class="account-pin-toggle" aria-label="启用密码" type="checkbox" :checked="enabled" :disabled="busy" @change="toggle">
        <span class="account-pin-box" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
        <span>锁屏密码</span>
      </label>
      <Transition name="pin-controls">
        <div v-if="enabled" class="account-pin-actions" :inert="!enabled || busy">
          <div v-if="editing" class="account-pin-cells" role="group" aria-label="设置四位密码">
            <input v-for="(_, index) in digits" :key="index" ref="fields" :value="digits[index]" class="account-pin-cell" :aria-label="`密码第 ${index + 1} 位`" type="text" inputmode="numeric" maxlength="2" autocomplete="off" spellcheck="false" :disabled="busy" :aria-invalid="!!error" @input="type(index, $event)" @keydown="key(index, $event)" @paste="paste" @focus="($event.target as HTMLInputElement).select()">
          </div>
          <div v-else class="account-pin-cells account-pin-saved" role="group" aria-label="当前密码"><span v-for="index in 4" :key="index" class="account-pin-cell readonly">{{ savedPin[index - 1] || '' }}</span></div>
          <button class="account-pin-link" :class="{ mute: editing }" type="button" :disabled="busy" @click="editing ? cancel() : startEdit()">{{ editing ? '取消' : '修改密码' }}</button>
          <span v-if="note" class="account-pin-note saved" role="status">{{ note }}</span>
        </div>
      </Transition>
    </form>
  </SettingRow>
  <p v-if="error" role="alert" class="account-setting-error">{{ error }}</p>
</template>
<style scoped>
.account-password-row :deep(.setting-control){margin-top:0}
.account-pin-control{display:flex;align-items:center;justify-content:flex-start;gap:16px;width:560px;max-width:100%;min-height:64px;box-sizing:border-box;padding:10px 0;margin:0}
.account-pin-label{position:relative;display:inline-flex;align-items:center;gap:10px;flex-shrink:0;font-weight:500;cursor:pointer}
.account-pin-toggle{position:absolute;z-index:1;left:0;top:50%;transform:translateY(-50%);opacity:0;width:18px;height:18px;margin:0;cursor:pointer}
.account-pin-box{display:grid;place-items:center;flex:none;width:18px;height:18px;box-sizing:border-box;border:1.5px solid var(--line-strong);border-radius:5px;background:var(--panel);color:white;transition:background .15s,border-color .15s}
.account-pin-box svg{opacity:0;transform:scale(.6);transition:opacity .15s,transform .18s cubic-bezier(.34,1.5,.64,1)}
.account-pin-label:hover .account-pin-box{border-color:var(--muted)}.account-pin-toggle:checked+.account-pin-box{background:var(--primary);border-color:var(--primary)}.account-pin-toggle:checked+.account-pin-box svg{opacity:1;transform:none}
.account-pin-toggle:focus-visible+.account-pin-box,.account-pin-link:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.account-pin-toggle:disabled~span{opacity:.6;cursor:wait}
.account-pin-actions{display:flex;align-items:center;gap:10px;min-width:0}.account-pin-note{font-size:12px;color:var(--muted);white-space:nowrap}.account-pin-note.saved{color:var(--success-text)}
.account-pin-cells{display:flex;gap:6px;flex:none}.account-pin-cell{display:grid;place-items:center;width:32px;height:40px;box-sizing:border-box;padding:0;border:1px solid var(--line-strong);border-radius:9px;background:var(--panel);color:var(--text);font-family:inherit;font-size:17px;font-weight:600;line-height:1.5;text-align:center;font-variant-numeric:tabular-nums;caret-color:var(--primary);outline:none;transition:border-color .15s,box-shadow .15s,background .15s}
.account-pin-cell:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 14%,transparent)}.account-pin-cell.readonly{background:var(--subtle-bg);border-color:transparent;box-shadow:none}.account-pin-cell[aria-invalid=true]{border-color:var(--danger,#ed566b)}
.account-pin-link{flex:none;height:30px;box-sizing:border-box;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--primary);font:inherit;cursor:pointer;white-space:nowrap;transition:background .15s}.account-pin-link:hover{background:color-mix(in srgb,var(--primary) 14%,transparent)}.account-pin-link.mute{color:var(--text-secondary)}.account-pin-link.mute:hover{background:var(--subtle-bg);color:var(--text)}.account-pin-link:disabled{opacity:.6;cursor:wait}
.pin-controls-enter-active,.pin-controls-leave-active{transition:opacity .2s}.pin-controls-enter-from,.pin-controls-leave-to{opacity:0;pointer-events:none}.account-setting-error{color:var(--danger,#ed566b);font-size:12px}
@media(max-width:700px){.account-pin-control{flex-wrap:wrap;gap:10px}.account-pin-actions{flex-wrap:wrap}.account-pin-note{max-width:100%;white-space:normal}}
</style>
