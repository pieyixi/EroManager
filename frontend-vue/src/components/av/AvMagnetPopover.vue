<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AvWork } from '../../api/contracts/av';
import { avApi } from '../../api/commands/av';
import { accountScope } from '../../api/accountContext';
import { useAvLibraryStore } from '../../stores/avLibrary';

const props = defineProps<{ work: AvWork; active: boolean }>();
const library = useAvLibraryStore();
const element = ref<HTMLElement | null>(null), field = ref<HTMLInputElement | null>(null);
const symbol = ref<SVGSVGElement | null>(null);
const open = ref(false), input = ref(''), error = ref(''), saving = ref(false), copied = ref('');
let revision = 0, copiedTimer: ReturnType<typeof setTimeout> | undefined;
let symbolMotion: Animation | undefined;
function moveSymbol(sway = false): void {
  const node = symbol.value;
  if (!node || !props.active) return;
  // 先接住正在轻晃的实际姿态，再摆正；取消 CSS 动画会直接跳到终点。
  const from = getComputedStyle(node).transform;
  node.style.transform = from; symbolMotion?.cancel();
  const target = open.value ? 'rotate(0deg)' : 'rotate(-24deg)';
  const frames = sway && !open.value
    ? [from, 'translateY(-.3px) rotate(-27deg)', 'translateY(.3px) rotate(-21deg)', from]
    : [from, target];
  const motion = node.animate(frames.map(transform => ({ transform })), {
    duration: sway ? 950 : 420, iterations: sway ? Infinity : 1,
    easing: sway ? 'ease-in-out' : 'cubic-bezier(.22,.8,.28,1)', fill: 'forwards',
  });
  symbolMotion = motion;
  motion.onfinish = () => { if (symbolMotion === motion) { node.style.transform = target; motion.cancel(); symbolMotion = undefined; } };
}
function hoverSymbol(): void { if (!open.value) moveSymbol(true); }
function reset(): void { revision++; open.value = false; input.value = ''; error.value = ''; saving.value = false; copied.value = ''; clearTimeout(copiedTimer); symbolMotion?.cancel(); symbolMotion = undefined; symbol.value?.style.removeProperty('transform'); }
watch(open, () => moveSymbol(), { flush: 'sync' });
watch([() => props.work.code, () => props.active, accountScope], reset);
async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value) { await nextTick(); field.value?.focus(); }
}
function outside(event: PointerEvent): void { if (open.value && !element.value?.contains(event.target as Node)) open.value = false; }
function escape(event: KeyboardEvent): void {
  if (open.value && event.key === 'Escape') { event.stopPropagation(); open.value = false; }
}
async function mutate(remove?: string): Promise<void> {
  if (saving.value) return;
  const owner = accountScope(), code = props.work.code, request = revision;
  saving.value = true; error.value = '';
  try {
    const updated = remove === undefined ? await avApi.addMagnet(code, input.value) : await avApi.removeMagnet(code, remove);
    if (request !== revision || owner !== accountScope() || code !== props.work.code) return;
    library.upsert(updated, false); if (remove === undefined) input.value = '';
  } catch (reason) { if (request === revision && owner === accountScope()) error.value = String(reason); }
  finally { if (request === revision) saving.value = false; }
}
async function copy(magnet: string): Promise<void> {
  const request = revision;
  try {
    await navigator.clipboard.writeText(magnet);
    if (request !== revision) return;
    copied.value = magnet; clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = ''; }, 1600);
  } catch { if (request === revision) error.value = '复制失败，请重试'; }
}
onMounted(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
onBeforeUnmount(() => { reset(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); });
</script>

<template>
  <Teleport to="body">
    <div v-if="active" ref="element" class="av-magnet-dock">
      <Transition name="magnet-bubble">
        <section v-if="open" class="av-magnet-bubble" aria-label="磁力链接">
          <div class="av-magnet-heading">磁力链接 <span>{{ work.magnets.length }}</span></div>
          <div v-if="work.magnets.length" class="av-magnet-list">
            <div v-for="(magnet, i) in work.magnets" :key="magnet" class="av-magnet-row">
              <span class="av-magnet-number">{{ i + 1 }}</span>
              <input :value="magnet" readonly aria-label="已保存的磁力链接" @focus="($event.target as HTMLInputElement).select()">
              <button type="button" class="av-magnet-action" :class="{ copied: copied === magnet }" :aria-label="copied === magnet ? `已复制磁力链接 ${i + 1}` : `复制磁力链接 ${i + 1}`" :title="copied === magnet ? '已复制' : '复制'" @click="copy(magnet)">
                <svg viewBox="0 0 24 24"><path v-if="copied === magnet" d="m5 12 4 4L19 6"/><template v-else><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4"/></template></svg>
              </button>
              <button type="button" class="av-magnet-action remove" :aria-label="`删除磁力链接 ${i + 1}`" title="删除" :disabled="saving" @click="mutate(magnet)"><svg viewBox="0 0 24 24"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>
            </div>
          </div>
          <form class="av-magnet-form" @submit.prevent="mutate()">
            <input ref="field" v-model="input" class="s-input" aria-label="添加磁力链接" placeholder="magnet:?xt=…" :disabled="saving">
            <button class="av-magnet-add" aria-label="添加" title="添加" :disabled="saving || !input.trim()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
          </form>
          <p v-if="error" class="av-detail-error" role="status">{{ error }}</p>
        </section>
      </Transition>
      <button type="button" class="av-magnet-trigger" :class="{ active: open }" aria-label="磁力链接" :aria-expanded="open" title="磁力链接" @click="toggle" @pointerenter="hoverSymbol" @pointerleave="moveSymbol()">
        <svg ref="symbol" class="av-magnet-symbol" viewBox="0 0 24 24"><path class="av-magnet-body" d="M5.8 3.5h3.4a.8.8 0 0 1 .8.8V13a2 2 0 0 0 4 0V4.3a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V13a7 7 0 0 1-14 0V4.3a.8.8 0 0 1 .8-.8ZM5 8h5M14 8h5"/></svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.av-magnet-dock { position: fixed; right: 28px; bottom: 28px; z-index: 85; }
.av-magnet-dock svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.av-magnet-trigger { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); border-radius: 13px; background: var(--panel); color: var(--text-secondary); cursor: pointer; box-shadow: 0 4px 16px var(--shell-shadow); transition: color .2s, background .2s, transform .2s; }
.av-magnet-trigger svg { width: 23px; height: 23px; }
.av-magnet-trigger .av-magnet-symbol { transform: rotate(-24deg); transform-origin: 50% 58%; }
.av-magnet-body { fill: color-mix(in srgb, currentColor 7%, transparent); stroke-width: 1.7; }
.av-magnet-trigger:hover, .av-magnet-trigger.active { color: var(--primary); background: var(--subtle-bg); }
.av-magnet-trigger:active { transform: scale(.94); }
.av-magnet-bubble { position: absolute; right: 0; bottom: 60px; width: min(420px, calc(100vw - 108px)); padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--text); box-shadow: 0 10px 36px var(--shell-shadow); transform-origin: calc(100% - 22px) calc(100% + 16px); }
.av-magnet-bubble::after { content: ''; position: absolute; right: 16px; bottom: -7px; width: 12px; height: 12px; background: var(--panel); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
.av-magnet-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 13px; font-weight: 600; }
.av-magnet-heading span { font-size: 11px; color: var(--muted); font-weight: 400; }
.av-magnet-list { max-height: min(280px, 40vh); overflow-y: auto; margin-bottom: 12px; }
.av-magnet-row { display: flex; align-items: center; gap: 6px; min-height: 38px; padding: 3px 0; }
.av-magnet-number { min-width: 14px; font-size: 11px; color: var(--muted); }
.av-magnet-row input { flex: 1; min-width: 0; padding: 6px 0; text-overflow: ellipsis; border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; }
.av-magnet-action { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.av-magnet-action:hover, .av-magnet-action.copied { color: var(--primary); background: var(--subtle-bg); }
.av-magnet-action.remove:hover { color: var(--danger); }
.av-magnet-form { display: flex; align-items: center; gap: 8px; }
.av-magnet-form input { flex: 1; min-width: 0; height: 34px; }
.av-magnet-add { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; padding: 0; border: 0; border-radius: 7px; background: var(--primary); color: white; cursor: pointer; }
.av-magnet-add:disabled { opacity: .4; cursor: default; }
.av-detail-error { margin: 10px 0 0; color: var(--danger); font-size: 12px; }
.magnet-bubble-enter-active, .magnet-bubble-leave-active { transition: opacity .22s ease, transform .28s cubic-bezier(.22,.8,.28,1); }
.magnet-bubble-enter-from, .magnet-bubble-leave-to { opacity: 0; transform: translateY(8px) scale(.94); }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
</style>
