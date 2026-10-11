/** Eh local-library DTOs. */
export interface EhGallerySummary {
  gid: number;
  token: string;
  source: 'eh' | 'hitomi';
  source_id: string;
  language: string;
  title: string;
  category: number;
  artist: string[];
  group: string[];
  tags: string[];
  artist_display: string[];
  group_display: string[];
  tags_display: string[];
  pages: number;
  posted: string;
  added_at: string;
  cover_path: string;
  folder_path: string;
}

export interface EhLibraryOverview {
  root_path: string;
  database_path: string;
  total_count: number;
  total_pages: number;
}

export interface EhReaderPage {
  index: number;
  path: string;
  width: number;
  height: number;
}

export interface SaveEhSettingsInput {
  rootPath: string;
  ipbMemberId: string;
  ipbPassHash: string;
  igneous: string;
}

export interface EhDownloadInput {
  gid: number;
  token: string;
  pageIndices?: number[];
}

export interface HitomiDownloadInput {
  id: number;
  pageIndices?: number[];
}

export interface EhDownloadFailure {
  page: number;
  reason: string;
}

export interface EhDownloadResult {
  gid: number;
  title: string;
  folder_path: string;
  total_pages: number;
  downloaded_pages: number;
  failures: EhDownloadFailure[];
  meta_path: string;
  cover_path: string;
}

export interface EhDownloadProgressEvent {
  gid: number;
  page: number;
  total_pages: number;
  percent: number;
  text: string;
}
