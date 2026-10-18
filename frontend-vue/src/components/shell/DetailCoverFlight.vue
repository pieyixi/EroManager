<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { coverFlight, coverFlightVisible, detailTransitionSource, detailTransitionDirection, detailOriginPage, flightTransform, registerCoverFlight, cancelDetailTransition } from '../../features/shell/detailTransition';
import { useNavigationStore } from '../../stores/navigation';

const frame = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const navigation = useNavigationStore();
watch(() => navigation.activePage, page => {
  const origin = detailTransitionSource.value;
  if (page !== 'page-detail' && (!origin || page !== detailOriginPage(origin))) cancelDetailTransition();
});
watch([frame, image], ([frameElement, imageElement]) => registerCoverFlight(frameElement, imageElement), { flush: 'post' });
const frameStyle = computed(() => {
  const flight = coverFlight.value;
  if (!flight) return {};
  return { width: `${flight.to.box.width}px`, height: `${flight.to.box.height}px`,
    transform: flightTransform(flight.from.box, flight.to.box), borderRadius: flight.to.radius,
    background: flight.to.background, borderColor: flight.to.border };
});
const imageStyle = computed(() => {
  const flight = coverFlight.value;
  if (!flight) return {};
  return { width: `${flight.to.image.width}px`, height: `${flight.to.image.height}px`,
    transform: flightTransform(flight.from.image, flight.to.image), borderRadius: flight.to.imageRadius };
});
onMounted(() => window.addEventListener('resize', cancelDetailTransition));
onBeforeUnmount(() => { window.removeEventListener('resize', cancelDetailTransition); registerCoverFlight(null, null); });
</script>

<template>
  <Teleport to="body">
    <div v-if="coverFlight" class="home-detail-flight" :data-origin="detailTransitionSource" :data-direction="detailTransitionDirection" :class="{ 'is-visible': coverFlightVisible }" aria-hidden="true">
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
.home-detail-flight-image { display: block; object-fit: cover; }
</style>
