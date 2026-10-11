/** Main media-library DTOs returned by the Rust commands. */
export interface TagSummary {
  id: number;
  name: string;
  category: string;
}

export interface WorkSummary {
  id: number;
  title: string;
  year: number;
  month: number;
  studio: string;
  description: string | null;
  cover_path: string | null;
  folder_path: string;
  episode_count: number;
  release_dates: string[];
  search_aliases: string[];
  tags: TagSummary[];
}

export interface PlayerEpisode {
  id: number;
  number?: number;
  title?: string;
  subtitle?: string;
  release_date?: string | null;
  video_path: string;
  cover_path?: string | null;
}

export interface EpisodeSummary extends PlayerEpisode {
  work_id: number;
}

export interface WorkDetail {
  work: WorkSummary;
  episodes: EpisodeSummary[];
  tags: TagSummary[];
  characters: string[];
}

export interface MediaLibraryStatus {
  root_path: string | null;
  library_id: string | null;
  source: string;
  rebound_paths: number;
  needs_binding: boolean;
}

export interface LibrarySummary {
  archived_count: number;
  unarchived_count: number;
  episode_count: number;
  total_bytes: number;
}

export interface ConsoleItem {
  work_id: number | null;
  title: string;
  status: string;
  folder_path: string;
  can_update: boolean;
  new_episode_numbers: number[];
}

export interface LibraryScan {
  summary: LibrarySummary;
  changed_works: ConsoleItem[];
  new_episode_works: ConsoleItem[];
  new_complete_works: ConsoleItem[];
  attention_works: ConsoleItem[];
}

export interface UnarchivedItem {
  title: string;
  folder_path: string;
  video_count: number;
  has_data_dir: boolean;
  has_meta_json: boolean;
  missing_reasons: string[];
  index_letter?: string;
}

export interface DuplicateItem {
  title: string;
  source: string;
  video_count: number;
  total_size: number;
  folder_path: string;
}

export interface DuplicateGroup {
  signature: string;
  items: DuplicateItem[];
}
