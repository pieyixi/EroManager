<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ verify: (value: string) => Promise<boolean>; disabled: boolean; error: string; mode?: 'pin' | 'id'; animateIntro?: boolean }>(), { mode: 'pin', animateIntro: true });
const field = ref<HTMLInputElement | null>(null), value = ref('');
const digits = ref(['', '', '', '']), filled = ref(0), cleared = ref(0), busy = ref(false), failed = ref(false), accepted = ref(false), remaining = ref(0);
const unavailable = computed(() => props.disabled || busy.value || accepted.value || remaining.value > 0);
let disposed = false, revision = 0, cooldown: ReturnType<typeof setInterval> | undefined;
const delays = new Map<ReturnType<typeof setTimeout>, () => void>();
// 所有动效等待都在离页时结算，不能留下旧账号验证回调或聚焦任务。
function delay(ms: number): Promise<void> {
  return new Promise(resolve => { const timer = setTimeout(() => { delays.delete(timer); resolve(); }, ms); delays.set(timer, resolve); });
}
function focus(): void { if (!disposed && !unavailable.value) field.value?.focus({ preventScroll: true }); }
function clear(): void { if (!unavailable.value) { value.value = ''; filled.value = 0; } }
async function finish(): Promise<void> { accepted.value = true; await delay(300); }
function reset(): void {
  revision++; clearInterval(cooldown);
  for (const [timer, resolve] of delays) { clearTimeout(timer); resolve(); } delays.clear();
  value.value = ''; filled.value = 0; cleared.value = 0; busy.value = false; failed.value = false; accepted.value = false; remaining.value = 0;
}
function handleKey(event: KeyboardEvent): void {
  const element = field.value;
  if (!element || disposed || event.target === element || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const number = /^\d$/.test(event.key), erase = event.key === 'Backspace' || event.key === 'Delete';
  const enter = props.mode === 'id' && event.key === 'Enter' && !(event.target instanceof Element && event.target.closest('button'));
  if (!number && !erase && !enter && event.key !== 'Escape') return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (unavailable.value) return;
  focus();
  if (enter) { void submit(); return; }
  if (event.key === 'Escape' || event.key === 'Delete') { clear(); return; }
  element.value = number ? (value.value + event.key).slice(0, 4) : value.value.slice(0, -1);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function input(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  if (unavailable.value) { input.value = value.value; return; }
  value.value = input.value.replace(/\D/g, '').slice(0, 4); input.value = value.value;
  filled.value = value.value.length;
  for (let i = 0; i < filled.value; i++) digits.value[i] = value.value[i]!;
  if (props.mode === 'pin' && filled.value === 4) await submit();
}
async function submit(): Promise<void> {
  if (unavailable.value || filled.value !== 4) return;
  const request = revision;
  busy.value = true;
  let success = false;
  try { success = await props.verify(value.value); }
  catch { /* 错误文案由验证入口提供，输入控件只负责反馈和复位。 */ }
  if (disposed || request !== revision) return;
  if (success) { busy.value = false; return; }
  failed.value = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await delay(reduce ? 100 : 420);
  if (disposed || request !== revision) return;
  failed.value = false;
  for (let i = 1; i <= 4; i++) { cleared.value = i; await delay(reduce ? 0 : 70); if (disposed || request !== revision) return; }
  await delay(reduce ? 0 : 160);
  if (disposed || request !== revision) return;
  value.value = ''; digits.value = ['', '', '', '']; filled.value = 0; cleared.value = 0; busy.value = false;
  const seconds = /请\s*(\d+)\s*秒/.exec(props.error)?.[1];
  if (seconds) {
    const until = Date.now() + Number(seconds) * 1000;
    remaining.value = Number(seconds);
    cooldown = setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (!remaining.value) { clearInterval(cooldown); focus(); }
    }, 250);
  }
  await nextTick(); focus();
}
onMounted(focus);
watch(unavailable, async blocked => { if (!blocked) { await nextTick(); focus(); } });
onBeforeUnmount(() => { disposed = true; reset(); });
defineExpose({ finish, focus, handleKey, reset });
</script>

<template>
  <div class="pin" :class="{ err: failed, ok: accepted, cool: remaining > 0, 'no-intro': !animateIntro }" role="group" :aria-label="mode === 'id' ? '输入四位账号 ID，按 Enter 确认' : '输入四位 PIN 解锁'" :aria-busy="busy" @pointerdown.prevent="focus">
    <span v-for="index in 4" :key="index" class="pin-digit" :class="{ on: index <= filled && index > cleared }" :style="{ animationDelay: `${(index - 1) * 80}ms` }" aria-hidden="true"><i></i><b>{{ digits[index - 1] }}</b></span>
    <input ref="field" :value="value" class="pin-field" :type="mode === 'id' ? 'text' : 'password'" :aria-label="mode === 'id' ? '账号 ID' : '四位 PIN'" inputmode="numeric" maxlength="4" autocomplete="off" :readonly="unavailable" :aria-invalid="failed" @input="input" @keydown.esc.stop.prevent="clear" @keydown.enter.stop.prevent="mode === 'id' && submit()">
    <span class="pin-cooldown" :class="{ show: remaining > 0 }" aria-live="polite">{{ remaining > 0 ? `请 ${remaining} 秒后再试` : '' }}</span>
  </div>
</template>

<style scoped>
.pin{--pin-ink:#454856;--pin-error:#b8493f;--pin-dot:#f4f5f8;--pin-shadow:0 1px 2px rgba(40,46,60,.20),0 0 0 .5px rgba(40,46,60,.07),inset 0 1.5px 2px rgba(40,46,60,.12),inset 0 -1px 1px #fff;position:relative;display:flex;justify-content:center;gap:14px;width:max-content;margin:auto;padding:20px;cursor:text;transition:opacity .3s ease,transform .3s ease}
:root[data-theme="dark"] .pin{--pin-ink:#dcdfe7;--pin-error:#ff8a7a;--pin-dot:#262a33;--pin-shadow:0 1px 2px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.06),inset 0 1.5px 2px rgba(0,0,0,.5),inset 0 -1px 1px rgba(255,255,255,.06)}
.pin.ok{opacity:0;transform:scale(1.06);pointer-events:none}.pin-digit{width:22px;height:26px;display:grid;place-items:center;animation:pin-in .5s ease both;transition:opacity .25s ease}.pin-digit i{grid-area:1/1;width:14px;height:14px;border-radius:50%;background:var(--pin-dot);box-shadow:var(--pin-shadow);transition:opacity .16s ease,transform .22s ease,filter .22s ease}.pin-digit b{grid-area:1/1;font:500 22px/1 "Yu Mincho","YuMincho","游明朝","Hiragino Mincho ProN","Noto Serif JP","Noto Serif SC",serif;color:var(--pin-ink);font-variant-numeric:tabular-nums;opacity:0;transform:scale(.55);filter:blur(2px);transition:opacity .16s ease,transform .26s cubic-bezier(.34,1.5,.64,1),filter .2s ease,color .15s ease}.pin-digit.on i{opacity:0;transform:scale(.35);filter:blur(1px)}.pin-digit.on b{opacity:1;transform:none;filter:none}.pin.err .pin-digit b{color:var(--pin-error)}.pin.err{animation:pin-shake .42s cubic-bezier(.36,.07,.19,.97)}.pin.cool .pin-digit{opacity:.5}.pin-cooldown{position:absolute;left:50%;top:100%;transform:translateX(-50%);white-space:nowrap;color:var(--muted);font-size:12px;opacity:0;transition:opacity .25s}.pin-cooldown.show{opacity:1}.pin-field{position:absolute;opacity:0;width:1px;height:1px;border:0;padding:0;pointer-events:none}
@keyframes pin-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes pin-shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-10px)}30%{transform:translateX(9px)}45%{transform:translateX(-7px)}60%{transform:translateX(5px)}75%{transform:translateX(-3px)}}
.pin.no-intro .pin-digit{animation:none}
@media(prefers-reduced-motion:reduce){.pin.err,.pin-digit{animation:none}.pin-digit i,.pin-digit b{transition:opacity .16s ease;filter:none;transform:none}.pin.ok{transform:none}}
</style>
