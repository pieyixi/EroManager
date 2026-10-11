/** Archive assistant DTOs. */
export interface ArchiveEpisodeTags {
  theme: string[];
  attribute: string[];
  scene: string[];
}

export interface ArchiveEpisode {
  id: number;
  subtitle: string;
  release_date: string;
  video_path: string;
  cover_path: string | null;
  tags: ArchiveEpisodeTags;
}

export interface ArchiveDraft {
  dir_path: string;
  title: string;
  search_aliases: string[];
  episodes: number;
  studio: string;
  synopsis: string;
  characters: Record<string, string>;
  episode_list: ArchiveEpisode[];
  cover_path: string | null;
  getchu_url: string;
  hanime_url: string;
}

export interface ArchiveSaveInput {
  dir_path: string;
  title: string;
  search_aliases: string[];
  studio: string;
  synopsis: string;
  characters: Record<string, string>;
  episode_list: ArchiveEpisode[];
  cover_data: string | null;
}

export interface ArchiveEpisodeCoverInput {
  id: number;
  image_data: string;
}
