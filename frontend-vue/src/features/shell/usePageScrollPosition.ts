import { watch, type Ref } from 'vue';
import { useNavigationStore, type PageId } from '../../stores/navigation';

/** display:none 前记录、恢复排版后还原；页面和来源页签分别保留自己的位置。 */
export function usePageScrollPosition(page: PageId, element: Ref<HTMLElement | null>, visible: () => boolean = () => true): void {
  const navigation = useNavigationStore();
  let top = 0;
  const active = () => navigation.activePage === page && visible();
  watch(active, (next, previous) => {
    if (previous && !next) top = element.value?.scrollTop || 0;
  }, { flush: 'sync' });
  watch(active, next => {
    if (next && element.value) element.value.scrollTop = top;
  }, { flush: 'post' });
}
