import { watch, type Ref } from 'vue';
import { useNavigationStore, type PageId } from '../../stores/navigation';

/** display:none 前记录、恢复排版后还原；每个下载列/页面各自持有位置，不放进业务状态。 */
export function usePageScrollPosition(page: PageId, element: Ref<HTMLElement | null>): void {
  const navigation = useNavigationStore();
  let top = 0;
  watch(() => navigation.activePage, (next, previous) => {
    if (previous === page && next !== page) top = element.value?.scrollTop || 0;
  }, { flush: 'sync' });
  watch(() => navigation.activePage, next => {
    if (next === page && element.value) element.value.scrollTop = top;
  }, { flush: 'post' });
}
