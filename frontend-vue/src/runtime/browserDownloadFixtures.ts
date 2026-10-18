import { createDownloadScene } from '../api/mock/downloadScene';
import { useEhDownloadStore } from '../stores/ehDownload';

/** 仅由 DEV 且无 Tauri 的运行时装配；组件和正式下载状态机不含 mock 分支。 */
export function installBrowserDownloadFixtures(): () => void {
  const store = useEhDownloadStore();
  const scene = createDownloadScene();
  const keys = new Set(scene.queue.map(item => item.key));
  store.queue.push(...scene.queue.filter(item => !store.queue.some(job => job.key === item.key)));
  store.history.push(...scene.history.filter(item => !store.history.some(history => history.gid === item.gid)));
  // 静态展示不占用真实 worker。用户手动开始下载/重试时撤下队列快照，仍走原有 FIFO。
  const stop = store.$onAction(({ name }) => {
    if (name === 'enqueue' || name === 'processQueue') {
      store.queue = store.queue.filter(item => !keys.has(item.key));
      stop();
    }
  });
  return stop;
}
