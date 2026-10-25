/** 本地 AV JSON 的浏览字段；时长、预览图与磁力保留在资料中，不作为筛选。 */
export interface AvActress {
  id: string;
  name: string;
  aliases: string[];
  photo: string;
}

export interface AvWork {
  code: string;
  title: string;
  cover: string;
  cover_layout: string;
  release_date: string;
  duration_minutes: number;
  studio: string;
  series: string;
  tags: string[];
  actresses: AvActress[];
  folder_path: string;
  source_url: string;
  queued_at: string;
  previews: string[];
  magnets: string[];
  videos: AvVideo[];
}

export interface AvVideo {
  id: number;
  kind: string;
  file_name: string;
  video_path: string;
}

export interface AvSettings {
  root_path: string;
}
export interface AvFetchResult {
  work: AvWork;
  warnings: string[];
}
