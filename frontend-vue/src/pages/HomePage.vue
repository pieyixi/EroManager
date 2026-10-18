<script setup lang="ts">
import type { WorkDetail } from '../api/contracts/library';
import { libraryApi } from '../api/commands/library';
import { onBeforeUnmount, ref, watch } from 'vue';
import { useNavigationStore } from '../stores/navigation';
import { useLibraryStore } from '../stores/library';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { type DrawPhase, drawBusy, useHomeStore } from '../stores/home';
import { cancelDetailTransition, detailTransitionSource, detailTransitionDirection, stableDetailPages, openCoverDetail } from '../features/shell/detailTransition';
import { prepareDrawImages as prepareImages } from '../features/home/images';
import HomeDrawCard from '../components/home/HomeDrawCard.vue';
import HomeHandDeck from '../components/home/HomeHandDeck.vue';
// 暂停左上问候区，保留图标组件与原有文案以便后续恢复。
// import HomeSkyIcon from '../components/home/HomeSkyIcon.vue';
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
  (source, selection) => {
    hand.add(source, selection); handExpanded.value = false; handError.value = ''; receipt.value += 1;
    void home.refillAfterTransfer(source, selection.id, prepareImages);
  },
);
function drawMedia(): void { void home.draw('media', prepareImages); }
function drawBook(): void { void home.draw('book', prepareImages); }
function dragMedia(event: PointerEvent): void { prepareMediaDetail(); handExpanded.value = false; down('media', home.media.current, event); }
function dragBook(event: PointerEvent): void { prepareBookDetail(); handExpanded.value = false; down('book', home.book.current, event); }
function mediaAnimationEnd(phase: DrawPhase): void { home.finishAnimation('media', phase); }
function bookAnimationEnd(phase: DrawPhase): void { home.finishAnimation('book', phase); }
let mediaPreparation: { id: number; result: Promise<WorkDetail | undefined> } | undefined;
function prepareMediaDetail(): void {
  const id = home.media.current?.id;
  if (id === undefined || mediaPreparation?.id === id) return;
  mediaPreparation = { id, result: libraryApi.getWorkDetail(id).then(async detail => {
    if (detail) await library.loadCovers([detail.work.cover_path, ...detail.episodes.map(episode => episode.cover_path)].filter((path): path is string => Boolean(path)));
    return detail;
  }).catch(() => undefined) };
}
let bookPreparation: { id: number; result: Promise<void> } | undefined;
function prepareBookDetail(): void {
  const gallery = books.galleries.find(item => item.gid === home.book.current?.id);
  if (gallery && bookPreparation?.id !== gallery.gid) bookPreparation = { id: gallery.gid, result: books.loadCovers([gallery.cover_path]).catch(() => undefined) };
}
async function mediaDetail(): Promise<void> {
  const id = home.media.current?.id;
  const revision = navigation.pageRevision;
  prepareMediaDetail();
  const prepared = await mediaPreparation?.result;
  if (navigation.activePage !== 'page-home' || navigation.pageRevision !== revision || home.media.current?.id !== id) return;
  await openCoverDetail('media', () => home.openDetail('media', undefined, prepared), { source: 'media', id: id! });
}
async function bookDetail(): Promise<void> {
  const id = home.book.current?.id;
  const revision = navigation.pageRevision;
  prepareBookDetail();
  await bookPreparation?.result;
  if (navigation.activePage !== 'page-home' || navigation.pageRevision !== revision || home.book.current?.id !== id) return;
  await openCoverDetail('book', () => home.openDetail('book'), { source: 'book', id: id! });
}
function closeHand(): void { handExpanded.value = false; handError.value = ''; }
function escape(): void { cancel(); closeHand(); }
let handPreparation: { key: string; result: Promise<WorkDetail | undefined> } | undefined;
function prepareHand(card: HandCard): void {
  if (handPreparation?.key === card.key) return;
  const result = card.source === 'media'
    ? libraryApi.getWorkDetail(card.id).then(async detail => {
      if (detail) await library.loadCovers([detail.work.cover_path, ...detail.episodes.map(episode => episode.cover_path)].filter((path): path is string => Boolean(path)));
      return detail;
    })
    : books.loadCovers([books.galleries.find(item => item.gid === card.id)?.cover_path || '']).then(() => undefined);
  handPreparation = { key: card.key, result: result.catch(() => undefined) };
}
async function openHand(card: HandCard): Promise<void> {
  handError.value = '';
  const revision = navigation.pageRevision;
  prepareHand(card);
  const prepared = await handPreparation?.result;
  if (navigation.activePage !== 'page-home' || navigation.pageRevision !== revision || hand.current?.key !== card.key) return;
  await openCoverDetail('hand', () => home.openDetail(card.source, card.id, prepared), { source: card.source, id: card.id });
  if (navigation.activePage === 'page-home') handError.value = home[card.source].error;
}
watch(() => [navigation.activePage, library.works, books.galleries, library.loading, books.loading, home.enabled], () => {
  if (navigation.activePage === 'page-home') home.ensureSelections(prepareImages);
  else { handPreparation = undefined; mediaPreparation = undefined; bookPreparation = undefined; home.cancelDraws(); cancel(); }
}, { immediate: true });
watch(() => [library.works.map((work) => work.id), books.galleries.map((gallery) => gallery.gid), library.loading, books.loading], () => {
  if (!library.loading && !books.loading) hand.reconcile(library.works.map((work) => work.id), books.galleries.map((gallery) => gallery.gid));
});
watch(() => hand.current?.key, () => { handError.value = ''; });
onBeforeUnmount(() => { home.cancelDraws(); cancelDetailTransition(); });
</script>

<template>
  <div id="page-home" class="page" :class="{ active: navigation.activePage === 'page-home', 'home-detail-stable': stableDetailPages, 'home-detail-returning': detailTransitionDirection === 'return' }" aria-label="首页" @keydown.esc.stop.prevent="escape">
    <!-- 左上问候区暂时关闭，保留原实现：
    <div class="home-greeting" aria-label="首页问候"><span>你好</span><HomeSkyIcon :active="navigation.activePage === 'page-home'" /><span>随便翻翻</span></div>
    -->
    <div class="home-draw-layout">
      <HomeDrawCard :transitioning="detailTransitionSource === 'media'" :active="navigation.activePage === 'page-home'" :allow-activate="allowDraw" label="里番" kind="media" :selection="home.media.current" :retiring="home.media.retiring" :phase="home.media.phase" :busy="drawBusy(home.media) || !!detailTransitionSource" :loading="library.loading" :error="home.media.error || library.error"
        :dragging="transfer?.source === 'media' && (transfer.phase === 'dragging' || transfer.phase === 'returning')"
        @draw="drawMedia" @animation-end="mediaAnimationEnd" @detail="mediaDetail" @card-pointer-down="dragMedia" @card-pointer-move="move" @card-pointer-up="up" @card-pointer-cancel="lostCapture" />
      <HomeDrawCard :transitioning="detailTransitionSource === 'book'" :active="navigation.activePage === 'page-home'" :allow-activate="allowDraw" label="本子" kind="book" :selection="home.book.current" :retiring="home.book.retiring" :phase="home.book.phase" :busy="drawBusy(home.book) || !!detailTransitionSource" :loading="books.loading" :error="home.book.error || books.error"
        :dragging="transfer?.source === 'book' && (transfer.phase === 'dragging' || transfer.phase === 'returning')"
        @draw="drawBook" @animation-end="bookAnimationEnd" @detail="bookDetail" @card-pointer-down="dragBook" @card-pointer-move="move" @card-pointer-up="up" @card-pointer-cancel="lostCapture" />
    </div>
    <Transition :name="hand.cards.length ? 'home-hand-shade' : ''">
      <div v-if="handExpanded" class="home-hand-backdrop" aria-hidden="true" @pointerdown="closeHand" />
    </Transition>
    <HomeHandDeck ref="handDeck" v-model:expanded="handExpanded" :active="navigation.activePage === 'page-home'" :dragging="transfer?.phase === 'dragging'" :over="overTarget" :receipt="receipt"
      :opening="home.media.openingDetail || home.book.openingDetail || !!detailTransitionSource" :error="handError" @prepare="prepareHand" @open="openHand" />
    <Teleport to="body">
      <div v-if="transfer && transfer.phase !== 'pending'" class="home-transfer-card" :class="`is-${transfer.phase}`" :style="ghostStyle" aria-hidden="true">
        <img v-if="transfer.selection.cover" :src="transfer.selection.cover" alt="" :draggable="false" />
        <span v-else>{{ transfer.selection.title }}</span>
      </div>
    </Teleport>
  </div>
</template>
