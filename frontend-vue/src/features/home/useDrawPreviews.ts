import { shallowRef, watch } from 'vue';
import type { DrawPhase, DrawPreview, DrawSelection } from '../../stores/home';

/** 预览属于已呈现的画面，不跟随请求候选或已移出的顶牌立即换图。 */
export function useDrawPreviews(selection: () => DrawSelection | null, phase: () => DrawPhase, active: () => boolean) {
  const previews = shallowRef<DrawPreview[]>([]);
  watch([selection, phase, active], ([current, currentPhase, isActive]) => {
    if (!isActive) previews.value = [];
    else if (currentPhase === 'settling' || currentPhase === 'idle') previews.value = current?.previews || [];
  }, { immediate: true });
  return previews;
}
