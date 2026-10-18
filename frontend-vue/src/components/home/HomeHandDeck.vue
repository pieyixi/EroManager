<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import { useHomeHandStore, type HandCard } from '../../stores/homeHand';
import { registerDetailCover, detailTransitionSource, coverFlightVisible } from '../../features/shell/detailTransition';
import { handPose, handSlots } from '../../features/home/handCarousel';
import { useHandInteraction } from '../../features/home/useHandInteraction';
import { useHandLayout, type HandLayoutItem } from '../../features/home/useHandLayout';

const props = defineProps<{ dragging: boolean; over: boolean; active: boolean; receipt: number; opening: boolean; error: string }>();
const expanded = defineModel<boolean>('expanded', { default: false });
const emit = defineEmits<{ open: [card: HandCard]; prepare: [card: HandCard] }>();
const hand = useHomeHandStore();
const root = ref<HTMLElement | null>(null);
const dropZone = ref<HTMLElement | null>(null);
const currentElement = ref<HTMLElement | null>(null);
const currentImage = ref<HTMLImageElement | null>(null);
watch([currentElement, currentImage], ([element, image]) => registerDetailCover('hand', element, image), { flush: 'post' });
onBeforeUnmount(() => registerDetailCover('hand', null));
const emptyElement = ref<HTMLElement | null>(null);
const hovered = ref(false);
let hoverReady = true;
const received = ref(false);
const broken = ref<string[]>([]);
const layoutChanging = ref(false);
let receiptTimer: ReturnType<typeof setTimeout> | undefined;
const interaction = useHandInteraction({ root, expanded, active: () => props.active,
  disabled: () => props.dragging || props.opening || layoutChanging.value, open: card => emit('open', card) });
const { position, moving, dragging: swiping, pressingKey, readyKey, lifted, liftStyle } = interaction;
const fanned = computed(() => hovered.value && !props.dragging && !expanded.value && !layoutChanging.value);

const expandedCards = computed(() => {
  const slots = handSlots(hand.cards.length, position.value);
  return slots.map(item => {
    const card = hand.cards[item.index]!;
    return { ...item, card, rank: 0, key: card.key };
  });
});

const targetCards = computed(() => {
  const count = hand.cards.length;
  if (expanded.value) return expandedCards.value;
  return Array.from({ length: Math.min(7, count) }, (_, rank) => {
    const index = (hand.activeIndex - Math.min(7, count) + 1 + rank + count) % count;
    const card = hand.cards[index]!;
    return { card, index, virtual: index, distance: 0, rank, key: card.key };
  });
});
const layout = useHandLayout({ root, expanded, active: () => props.active,
  target: () => targetCards.value, mainKey: () => hand.current?.key, prepareClose: interaction.freezeSelection });
watch(layout.changing, value => { layoutChanging.value = value; }, { flush: 'sync' });
const visibleCards = layout.cards;
function cardStyle(item: HandLayoutItem): Record<string, string | number> {
  if (expanded.value) {
    const pose = handPose(item.distance, hand.cards.length);
    return { '--hand-x': `${pose.x}%`, '--hand-y': `${pose.y}%`, '--hand-angle': '0deg',
      '--hand-scale': pose.scale, '--hand-opacity': pose.opacity, zIndex: pose.layer, ...layout.style(item.key) };
  }
  const count = Math.min(7, hand.cards.length);
  const distance = item.rank - (count - 1) / 2;
  const behind = count - 1 - item.rank;
  return { '--hand-x': `${fanned.value ? distance * 9 : -behind * 3}px`, '--hand-y': `${fanned.value ? 0 : -behind * 2}px`,
    '--hand-angle': `${fanned.value ? distance * Math.min(15, 42 / Math.max(1, count - 1)) : -behind * 1.6}deg`,
    '--hand-scale': 1, '--hand-opacity': 1, zIndex: item.rank + 1, ...layout.style(item.key) };
}
function isMain(item: typeof visibleCards.value[number]): boolean {
  return expanded.value ? Math.abs(item.distance) < .5 : item.index === hand.activeIndex;
}
function rememberCard(element: Element | ComponentPublicInstance | null, item: HandLayoutItem): void {
  layout.remember(element, item);
  if (isMain(item)) currentElement.value = element as HTMLElement | null;
}
function rememberImage(element: Element | ComponentPublicInstance | null, item: HandLayoutItem): void {
  if (isMain(item)) currentImage.value = element as HTMLImageElement | null;
}
function keyboardActivate(virtual: number, event: MouseEvent): void {
  if (event.detail === 0) interaction.activate(virtual);
}
function pointerMove(event: PointerEvent): void {
  if (!layoutChanging.value && !expanded.value) {
    hoverReady = true;
    hovered.value = true;
  }
  interaction.pointerMove(event);
}
function cardPointerDown(event: PointerEvent, item: HandLayoutItem): void {
  if (expanded.value && isMain(item) && !props.opening) emit('prepare', item.card);
  if (layoutChanging.value && !expanded.value && !props.dragging && !props.opening && event.button === 0 && event.isPrimary) {
    event.preventDefault();
    interaction.expandAt(item.index);
    return;
  }
  interaction.pointerDown(event, item.virtual);
}
function keydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); interaction.step(event.key === 'ArrowRight' ? 1 : -1);
  } else if (event.key === 'Enter' && event.target === root.value && hand.cards.length) {
    event.preventDefault(); expanded.value = true;
  }
}
watch(() => props.receipt, () => {
  received.value = true;
  clearTimeout(receiptTimer);
  receiptTimer = setTimeout(() => { received.value = false; }, 480);
});
watch(() => props.active, active => { if (!active) hovered.value = false; });
watch(expanded, () => { hovered.value = false; hoverReady = false; }, { flush: 'sync' });
watch(() => hand.cards.length, count => { if (!count) expanded.value = false; });
onBeforeUnmount(() => clearTimeout(receiptTimer));

defineExpose({
  containsPoint(x: number, y: number): boolean {
    const rect = dropZone.value?.getBoundingClientRect();
    return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  },
  landingRect() {
    const rect = (hand.cards.length ? currentElement.value : emptyElement.value)?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  },
});
</script>

<template>
  <section ref="root" class="home-hand" :class="{ 'is-expanded': expanded, 'is-layout-changing': layoutChanging, 'is-fanned': fanned, 'is-dragging-over': over, 'is-receiving': received, 'is-swiping': swiping, 'is-moving': moving }"
    :aria-label="`暂存手牌，${hand.cards.length}张`" tabindex="0" @pointerenter="hovered = hoverReady && !layoutChanging" @pointerleave="hovered = false"
    @pointerdown="interaction.pointerDown($event, null)" @pointermove="pointerMove" @pointerup="interaction.pointerUp"
    @pointercancel="interaction.cancel" @lostpointercapture="interaction.lostCapture" @wheel.prevent.stop="interaction.wheel" @keydown="keydown">
    <div ref="dropZone" class="home-hand-drop-zone" aria-hidden="true" />
    <div v-if="!hand.cards.length" ref="emptyElement" class="home-hand-empty">
      <span class="home-hand-empty-mark" aria-hidden="true">＋</span><span>拖到这里</span>
    </div>
    <div v-else class="home-hand-cards" :aria-busy="opening">
      <button v-for="item in visibleCards" :key="item.key" :ref="element => rememberCard(element, item)"
        type="button" class="home-hand-card" :class="{ 'is-main': isMain(item), 'home-detail-cover-hidden': isMain(item) && detailTransitionSource === 'hand' && coverFlightVisible, 'is-pressing': pressingKey === item.card.key && isMain(item), 'is-hold-ready': readyKey === item.card.key && isMain(item), 'is-lifted': lifted?.card.key === item.card.key }" :style="cardStyle(item)"
        :data-card-key="item.card.key" :data-virtual-index="item.virtual" :data-slot="expanded ? item.distance : undefined" :title="item.card.title"
        :aria-hidden="expanded && Math.abs(item.distance) > 1.25" :aria-label="`${item.card.title}，${expanded && isMain(item) ? '进入详情' : '查看手牌'}`"
        :tabindex="expanded ? Math.abs(item.distance) <= 1 ? 0 : -1 : item.index === hand.activeIndex ? 0 : -1"
        @pointerdown.stop="cardPointerDown($event, item)"
        @click.prevent="keyboardActivate(item.virtual, $event)">
        <img :ref="element => rememberImage(element, item)" v-if="item.card.cover && !broken.includes(item.card.key)" :src="item.card.cover" alt="" :draggable="false" @error="broken.push(item.card.key)" />
        <span v-else class="home-hand-card-placeholder">{{ item.card.title }}</span>
      </button>
    </div>
    <p v-if="expanded && error" class="home-hand-error" role="status">{{ error }}</p>
    <Teleport to="body">
      <div v-if="lifted" class="home-hand-lift" :class="`is-${lifted.phase}`" :style="liftStyle" aria-hidden="true">
        <img v-if="lifted.card.cover && !broken.includes(lifted.card.key)" :src="lifted.card.cover" alt="" :draggable="false" />
        <span v-else class="home-hand-card-placeholder">{{ lifted.card.title }}</span>
      </div>
    </Teleport>
  </section>
</template>
