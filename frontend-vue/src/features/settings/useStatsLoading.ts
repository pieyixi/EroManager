import { onScopeDispose, ref, watch } from 'vue';

/** 慢请求才显示提示/刷新淡化；定时器随弹窗关闭和组件销毁清理。 */
export function useStatsLoading(open: () => boolean, loading: () => boolean) {
  const delayed = ref(false), slow = ref(false);
  let feedback: ReturnType<typeof setTimeout> | undefined, notice: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(feedback); clearTimeout(notice); delayed.value = false; slow.value = false; };
  watch([open, loading], ([visible, pending]) => {
    clear();
    if (visible && pending) {
      feedback = setTimeout(() => { delayed.value = true; }, 150);
      notice = setTimeout(() => { slow.value = true; }, 3000);
    }
  }, { immediate: true });
  onScopeDispose(clear);
  return { delayed, slow };
}
