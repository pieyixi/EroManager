export interface UserPreferences {
  theme: '' | 'light' | 'dark' | 'system';
  startup_page: 'home' | 'media-library' | 'eh-library';
  media_sort: 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc';
  book_sort: 'added-desc' | 'added-asc' | 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc';
  player_loop: 'off' | 'one' | 'all';
  player_auto_next: boolean;
  player_volume: number;
  player_speed: number;
  player_fit: 'contain' | 'fill' | 'original';
  remember_playback: boolean;
  reader_mode: 'double' | 'single';
  reader_direction: 'rtl' | 'ltr';
  reader_wheel: boolean;
  reader_zoom: number;
  remember_reading: boolean;
  download_notify: boolean;
  eh_parallel_images: number;
  hitomi_parallel_images: number;
  close_action: 'tray' | 'exit';
  close_prompt: boolean;
}
export function defaultPreferences(): UserPreferences {
  return { theme: '', startup_page: 'home', media_sort: 'time-desc', book_sort: 'added-desc',
    player_loop: 'off', player_auto_next: false, player_volume: 80, player_speed: 1, player_fit: 'contain',
    remember_playback: true, reader_mode: 'double', reader_direction: 'rtl', reader_wheel: true,
    reader_zoom: 100, remember_reading: true, download_notify: true, eh_parallel_images: 3, hitomi_parallel_images: 3,
    close_action: 'tray', close_prompt: true };
}
export interface WorkRecord {
  kind: 'media' | 'book';
  content_id: number;
  position: number;
  pair_offset: number;
  merged_pairs: string[];
}
export interface ApplicationInfo {
  version: string;
  app_directory: string;
  database_directory: string;
}
