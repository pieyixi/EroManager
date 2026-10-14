<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useNavigationStore } from '../stores/navigation';
import { useLibraryStore } from '../stores/library';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { type DrawPhase, type DrawSelection, drawBusy, useHomeStore } from '../stores/home';
import { decodeDrawImages } from '../features/home/images';
import HomeDrawCard from './HomeDrawCard.vue';
import HomeHandDeck from './HomeHandDeck.vue';
// 暂停左上问候区，保留图标组件与原有文案以便后续恢复。
// import HomeSkyIcon from './home/HomeSkyIcon.vue';
import { useHomeHandStore, type HandCard } from '../stores/homeHand';
import { useCardTransfer } from '../features/home/useCardTransfer';

const navigation = useNavigationStore();
const library = useLibraryStore();
const books = useEhLibraryStore();
const home = useHomeStore();
const hand = useHomeHandStore();
const handDeck = ref<InstanceType<typeof HomeHandDeck> | null>(null);
const handExpanded = ref(false);
const handError = ref('');
const receipt = ref(0);
const { transfer, overTarget, ghostStyle, down, move, up, cancel, lostCapture, allowDraw } = useCardTransfer(
  () => handDeck.value,
  (source, selection) => { hand.add(source, selection); handExpanded.value = false; handError.value = ''; receipt.value += 1; },
);
function prepareImages(selection: DrawSelection): Promise<void> { return decodeDrawImages([selection.cover, ...selection.previews.map((item) => item.image)]); }
function drawMedia(event: MouseEvent): void { if (allowDraw(event)) void home.draw('media', prepareImages); }
function drawBook(event: MouseEvent): void { if (allowDraw(event)) void home.draw('book', prepareImages); }
function dragMedia(event: PointerEvent): void { handExpanded.value = false; down('media', home.media.current, event); }
function dragBook(event: PointerEvent): void { handExpanded.value = false; down('book', home.book.current, event); }
function mediaAnimationEnd(phase: DrawPhase): void { home.finishAnimation('media', phase); }
function bookAnimationEnd(phase: DrawPhase): void { home.finishAnimation('book', phase); }
function mediaDetail(): void { void home.openDetail('media'); }
function bookDetail(): void { void home.openDetail('book'); }
function closeHand(): void { handExpanded.value = false; handError.value = ''; }
function escape(): void { cancel(); closeHand(); }
async function openHand(card: HandCard): Promise<void> {
  handError.value = '';
  await home.openDetail(card.source, card.id);
  if (navigation.activePage === 'page-home') handError.value = home[card.source].error;
}
watch(() => [navigation.activePage, library.works, books.galleries, library.loading, books.loading], () => {
  if (navigation.activePage === 'page-home') home.ensureSelections(prepareImages);
  else { home.cancelDraws(); cancel(); }
}, { immediate: true });
watch(() => [library.works.map((work) => work.id), books.galleries.map((gallery) => gallery.gid), library.loading, books.loading], () => {
  if (!library.loading && !books.loading) hand.reconcile(library.works.map((work) => work.id), books.galleries.map((gallery) => gallery.gid));
});
watch(() => hand.current?.key, () => { handError.value = ''; });
onBeforeUnmount(() => home.cancelDraws());
onMounted(() => {
  if (!books.overview && !books.loading) void books.load();
});
</script>

<template>
  <div id="page-home" class="page" :class="{ active: navigation.activePage === 'page-home' }" aria-label="首页" @keydown.esc.stop.prevent="escape">
    <!-- 左上问候区暂时关闭，保留原实现：
    <div class="home-greeting" aria-label="首页问候"><span>你好</span><HomeSkyIcon :active="navigation.activePage === 'page-home'" /><span>随便翻翻</span></div>
    -->
    <div class="home-draw-layout">
      <HomeDrawCard label="里番" kind="media" :selection="home.media.current" :retiring="home.media.retiring" :phase="home.media.phase" :busy="drawBusy(home.media)" :loading="library.loading" :error="home.media.error || library.error"
        :dragging="transfer?.source === 'media' && (transfer.phase === 'dragging' || transfer.phase === 'returning')"
        @draw="drawMedia" @animation-end="mediaAnimationEnd" @detail="mediaDetail" @card-pointer-down="dragMedia" @card-pointer-move="move" @card-pointer-up="up" @card-pointer-cancel="lostCapture" />
      <HomeDrawCard label="本子" kind="book" :selection="home.book.current" :retiring="home.book.retiring" :phase="home.book.phase" :busy="drawBusy(home.book)" :loading="books.loading" :error="home.book.error || books.error"
        :dragging="transfer?.source === 'book' && (transfer.phase === 'dragging' || transfer.phase === 'returning')"
        @draw="drawBook" @animation-end="bookAnimationEnd" @detail="bookDetail" @card-pointer-down="dragBook" @card-pointer-move="move" @card-pointer-up="up" @card-pointer-cancel="lostCapture" />
    </div>
    <Transition :name="hand.cards.length ? 'home-hand-shade' : ''">
      <div v-if="handExpanded" class="home-hand-backdrop" aria-hidden="true" @pointerdown="closeHand" />
    </Transition>
    <HomeHandDeck ref="handDeck" v-model:expanded="handExpanded" :active="navigation.activePage === 'page-home'" :dragging="transfer?.phase === 'dragging'" :over="overTarget" :receipt="receipt"
      :opening="home.media.openingDetail || home.book.openingDetail" :error="handError" @open="openHand" />
    <Teleport to="body">
      <div v-if="transfer && transfer.phase !== 'pending'" class="home-transfer-card" :class="`is-${transfer.phase}`" :style="ghostStyle" aria-hidden="true">
        <img v-if="transfer.selection.cover" :src="transfer.selection.cover" alt="" :draggable="false" />
        <span v-else>{{ transfer.selection.title }}</span>
      </div>
    </Teleport>
  </div>
</template>
