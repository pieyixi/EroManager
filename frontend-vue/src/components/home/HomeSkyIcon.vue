<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { skyForHour } from '../../features/home/sky';
import DawnScene from './sky/DawnScene.vue';
import MorningScene from './sky/MorningScene.vue';
import NoonScene from './sky/NoonScene.vue';
import AfternoonScene from './sky/AfternoonScene.vue';
import DuskScene from './sky/DuskScene.vue';
import NightScene from './sky/NightScene.vue';
import LateScene from './sky/LateScene.vue';
import PreScene from './sky/PreScene.vue';

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const prefix = useId();
const hour = ref(new Date().getHours());
const scene = computed(() => skyForHour(hour.value));
const scenes = { dawn: DawnScene, morning: MorningScene, noon: NoonScene, afternoon: AfternoonScene, dusk: DuskScene, night: NightScene, late: LateScene, pre: PreScene };
const labels = {"dawn":"清晨：日出","morning":"上午：晴","noon":"中午：烈日","afternoon":"下午：暖阳与热茶","dusk":"傍晚：夕阳","night":"夜晚：月亮与星星","late":"深夜：繁星与流星","pre":"凌晨：月落"};
let timer: ReturnType<typeof setTimeout> | undefined;

// 只更新图标，保持两侧问候/tag 文案不变；离开首页时停表并暂停动画。
function refresh(): void {
  clearTimeout(timer);
  if (!props.active) return;
  const now = Date.now();
  hour.value = new Date(now).getHours();
  timer = setTimeout(refresh, 60_000 - now % 60_000 + 25);
}
watch(() => props.active, refresh, { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <span class="home-sky-icon" :class="{ 'is-paused': !active }" :data-scene="scene" role="img" :aria-label="labels[scene]">
    <component :is="scenes[scene]" :prefix="prefix" />
  </span>
</template>

<style scoped>
.home-sky-icon {
  --sky-ring: rgba(17, 24, 39, .1);
  display: inline-flex; flex: 0 0 var(--home-sky-size, 2em);
  width: var(--home-sky-size, 2em); height: var(--home-sky-size, 2em); pointer-events: none;
}
:root[data-theme="dark"] .home-sky-icon { --sky-ring: rgba(255, 255, 255, .14); }
.home-sky-icon :deep(.sky-scene) { display: block; width: 100%; height: 100%; overflow: visible; }
.home-sky-icon.is-paused :deep(.sky-o) { animation-play-state: paused; }
.home-sky-icon :deep(.sky-scene .sky-ring) {fill:none;stroke:var(--sky-ring,rgba(17,24,39,.10));stroke-width:1}
.home-sky-icon :deep(.sky-o) {transform-box:fill-box;transform-origin:center}
.home-sky-icon :deep(.sky-spin) {animation:sky-spin var(--d,24s) linear infinite}
.home-sky-icon :deep(.sky-drift) {animation:sky-drift var(--d,9s) ease-in-out infinite alternate}
.home-sky-icon :deep(.sky-float) {animation:sky-float var(--d,5s) ease-in-out infinite alternate}
.home-sky-icon :deep(.sky-glow) {animation:sky-glow 4.5s ease-in-out infinite}
.home-sky-icon :deep(.sky-blink) {animation:sky-blink 5s infinite}
.home-sky-icon :deep(.sky-tw) {animation:sky-twinkle var(--d,3s) ease-in-out var(--l,0s) infinite}
.home-sky-icon :deep(.sky-rise) {animation:sky-rise 7s ease-in-out infinite alternate}
.home-sky-icon :deep(.sky-sink) {animation:sky-sink 8s ease-in-out infinite alternate}
.home-sky-icon :deep(.sky-sway) {animation:sky-sway 6s ease-in-out infinite alternate}
.home-sky-icon :deep(.sky-steam) {animation:sky-steam 3.4s ease-in-out var(--l,0s) infinite}
.home-sky-icon :deep(.sky-shimmer) {animation:sky-shimmer 2.6s ease-in-out var(--l,0s) infinite}
.home-sky-icon :deep(.sky-fly) {animation:sky-fly var(--d,15s) linear var(--l,0s) infinite}
.home-sky-icon :deep(.sky-yawn) {animation:sky-yawn 6s ease-in-out infinite}
.home-sky-icon :deep(.sky-zz) {animation:sky-zz 4.2s ease-out var(--l,0s) infinite}
.home-sky-icon :deep(.sky-shoot) {animation:sky-shoot 8s ease-in infinite}
.home-sky-icon :deep(.sky-moonset) {animation:sky-moonset 9s ease-in-out infinite alternate}

@keyframes sky-spin{to{transform:rotate(360deg)}}
@keyframes sky-drift{from{transform:translateX(-4px)}to{transform:translateX(5px)}}
@keyframes sky-float{from{transform:translateY(-1.5px)}to{transform:translateY(1.5px)}}
@keyframes sky-glow{0%,100%{opacity:var(--o1,.55);transform:scale(1)}50%{opacity:var(--o2,.9);transform:scale(1.15)}}
@keyframes sky-blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
@keyframes sky-twinkle{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.6)}}
@keyframes sky-rise{from{transform:translateY(9px)}to{transform:translateY(-5px)}}
@keyframes sky-sink{from{transform:translateY(-8px)}to{transform:translateY(6px)}}
@keyframes sky-sway{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}
@keyframes sky-steam{0%{transform:translateY(3px);opacity:0}30%{opacity:.85}100%{transform:translateY(-7px);opacity:0}}
@keyframes sky-shimmer{0%,100%{opacity:.25;transform:scaleX(.8)}50%{opacity:.9;transform:scaleX(1.1)}}
@keyframes sky-fly{from{transform:translateX(-16px)}to{transform:translateX(112px)}}
@keyframes sky-yawn{0%,58%,100%{transform:scaleY(.18)}68%,84%{transform:scaleY(1)}}
@keyframes sky-zz{0%{transform:translate(0,0) scale(.6);opacity:0}25%{opacity:.9}100%{transform:translate(8px,-16px) scale(1.1);opacity:0}}
@keyframes sky-shoot{0%,60%{transform:translate(80px,12px);opacity:0}64%{opacity:1}78%{transform:translate(36px,34px);opacity:1}80%,100%{transform:translate(36px,34px);opacity:0}}
@keyframes sky-moonset{from{transform:translateY(-3px)}to{transform:translateY(8px)}}
</style>
