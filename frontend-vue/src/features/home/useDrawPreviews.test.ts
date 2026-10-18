import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { DrawPhase, DrawSelection } from '../../stores/home';
import { useDrawPreviews } from './useDrawPreviews';

const card = (id: number): DrawSelection => ({ id, title: String(id), cover: `cover-${id}`,
  previews: [{ key: String(id), label: 'page', image: `preview-${id}` }] });

describe('home preview presentation timing', () => {
  it.each(['ordinary', 'collected'] as const)('keeps outgoing previews through %s draws and switches on the landing sweep', async kind => {
    const scope = effectScope();
    const old = card(1), next = card(2);
    const selection = ref<DrawSelection | null>(old), phase = ref<DrawPhase>('idle'), active = ref(true);
    const previews = scope.run(() => useDrawPreviews(() => selection.value, () => phase.value, () => active.value))!;
    if (kind === 'collected') { selection.value = null; phase.value = 'waiting'; }
    else phase.value = 'closing';
    await nextTick();
    expect(previews.value[0]?.image).toBe('preview-1');
    selection.value = next; phase.value = 'opening'; await nextTick();
    expect(previews.value[0]?.image).toBe('preview-1');
    phase.value = 'settling'; await nextTick();
    expect(previews.value[0]?.image).toBe('preview-2');
    phase.value = 'idle'; await nextTick();
    expect(previews.value[0]?.image).toBe('preview-2');
    active.value = false; await nextTick(); expect(previews.value).toEqual([]);
    active.value = true; await nextTick(); expect(previews.value[0]?.image).toBe('preview-2');
    scope.stop();
  });
});
