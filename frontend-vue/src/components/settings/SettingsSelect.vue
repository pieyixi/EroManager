<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
const props = defineProps<{ label: string; source?: string; prefix?: string; modelValue: string | number; options: { value: string | number; label: string }[]; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: string | number, origin: { x: number; y: number }] }>();
const id = useId();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const leaving = ref(false);
const above = ref(false);
const active = ref(0);
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? String(props.modelValue));
function close(): void { if (open.value) leaving.value = true; open.value = false; }
async function reveal(): Promise<void> {
  if (props.disabled) return;
  leaving.value = false;
  active.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue));
  const rect = trigger.value!.getBoundingClientRect();
  above.value = innerHeight - rect.bottom < Math.min(260, props.options.length * 40 + 16) && rect.top > 280;
  open.value = true;
  await nextTick(); menu.value?.focus();
}
function choose(index: number): void {
  const option = props.options[index];
  if (!option) return;
  const rect = trigger.value!.getBoundingClientRect();
  emit('change', option.value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  close(); trigger.value?.focus();
}
function keydown(event: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault();
  if (event.key === 'Escape') { close(); trigger.value?.focus(); }
  if (event.key === 'Tab') close();
  if (event.key === 'ArrowDown') active.value = (active.value + 1) % props.options.length;
  if (event.key === 'ArrowUp') active.value = (active.value + props.options.length - 1) % props.options.length;
  if (event.key === 'Home') active.value = 0;
  if (event.key === 'End') active.value = props.options.length - 1;
  if (event.key === 'Enter' || event.key === ' ') choose(active.value);
  void nextTick(() => menu.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }));
}
function outside(event: PointerEvent): void { if (!root.value?.contains(event.target as Node)) close(); }
function scroll(event: Event): void { if (!(event.target instanceof Node) || !menu.value?.contains(event.target)) close(); }
watch(open, value => {
  if (value) { document.addEventListener('pointerdown', outside); document.addEventListener('scroll', scroll, true); }
  else { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); }
});
watch(() => props.disabled, value => { if (value) close(); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); });
</script>
<template>
  <div ref="root" class="settings-select" :class="{ 'is-open': open, 'is-closing': leaving, 'opens-above': above }">
    <button ref="trigger" class="settings-select-trigger" type="button" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="id" :disabled="disabled" @click="open ? close() : reveal()" @keydown.down.prevent="reveal()" @keydown.up.prevent="reveal()"><span v-if="source" class="settings-select-source">{{ source }}</span><span v-if="prefix" class="settings-select-prefix">{{ prefix }}</span><span class="settings-select-value">{{ selected }}</span><svg class="settings-select-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
    <Transition name="settings-select-menu" @after-leave="leaving = false">
      <div v-if="open" :id="id" ref="menu" class="settings-select-options" role="listbox" :aria-label="label" :aria-activedescendant="`${id}-${active}`" tabindex="-1" @keydown="keydown">
        <div v-for="(option, index) in options" :id="`${id}-${index}`" :key="option.value" role="option" :aria-selected="option.value === modelValue" :class="{ 'is-highlighted': index === active }" @pointermove="active = index" @click="choose(index)">{{ option.label }}</div>
      </div>
    </Transition>
  </div>
</template>
