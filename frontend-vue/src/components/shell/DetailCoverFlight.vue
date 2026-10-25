<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { coverFlight, coverFlightVisible, detailTransitionSource, detailTransitionDirection, detailOriginPage, coverFrameKeyframe, coverImageKeyframe, coverViewportKeyframe, registerCoverFlight, cancelDetailTransition } from '../../features/shell/detailTransition';
import { useNavigationStore } from '../../stores/navigation';

const frame = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const navigation = useNavigationStore();
watch(() => navigation.activePage, page => {
  const origin = detailTransitionSource.value;
  if (page !== 'page-detail' && (!origin || page !== detailOriginPage(origin))) cancelDetailTransition();
});
watch([frame, image, viewport], ([frameElement, imageElement, viewportElement]) => registerCoverFlight(frameElement, imageElement, viewportElement), { flush: 'post' });
const frameStyle = computed(() => {
  const flight = coverFlight.value;
  if (!flight) return {};
  return { width: `${flight.to.box.width}px`, height: `${flight.to.box.height}px`,
    ...coverFrameKeyframe(flight.from, flight.to) };
});
const imageStyle = computed(() => {
  const flight = coverFlight.value;
  if (!flight) return {};
  return { width: `${flight.raster.width}px`, height: `${flight.raster.height}px`,
    ...coverImageKeyframe(flight.from, flight.raster) };
});
const viewportStyle = computed(() => {
  const clip = coverFlight.value?.viewport;
  return clip ? coverViewportKeyframe(clip.from) : {};
});
onMounted(() => window.addEventListener('resize', cancelDetailTransition));
onBeforeUnmount(() => { window.removeEventListener('resize', cancelDetailTransition); registerCoverFlight(null, null); });
</script>

<template>
  <Teleport :to="coverFlight?.container || 'body'">
    <div v-if="coverFlight" ref="viewport" class="home-detail-flight" :style="viewportStyle" :data-origin="detailTransitionSource" :data-direction="detailTransitionDirection" :class="{ 'is-visible': coverFlightVisible }" aria-hidden="true">
      <div ref="frame" class="home-detail-flight-frame" :style="frameStyle" />
      <img ref="image" class="home-detail-flight-image" :src="coverFlight.src || undefined" :style="imageStyle" alt="" :draggable="false">
    </div>
  </Teleport>
</template>

<style scoped>
.home-detail-flight { position: fixed; inset: 0; z-index: 1000; pointer-events: none; visibility: hidden; }
.home-detail-flight.is-visible { visibility: visible; }
.home-detail-flight-frame, .home-detail-flight-image { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.home-detail-flight-frame { border: 1px solid; box-shadow: 0 12px 28px var(--shell-shadow); }
.home-detail-flight-image { display: block; object-fit: fill; will-change: transform, clip-path; }
</style>
