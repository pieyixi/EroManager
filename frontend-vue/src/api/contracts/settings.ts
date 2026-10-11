/** Settings, scanning and maintenance DTOs. */
export interface BackupProgressEvent {
  percent: number;
  text: string;
}

export interface EhScanProgressEvent {
  percent: number;
  text: string;
}

export interface EhSettings {
  root_path: string;
  ipb_member_id: string;
  ipb_pass_hash: string;
  igneous: string;
}

export interface EhScanIssue {
  title: string;
  folder_path: string;
  reason: string;
}

export interface EhScanResult {
  folders: number;
  indexed: number;
  created_meta: number;
  created_cover: number;
  removed_records: number;
  skipped: number;
  errors: EhScanIssue[];
}

export interface EhCategoryMetric {
  category: number;
  label: string;
  count: number;
  bytes: number;
}

export interface EhLibraryDashboard {
  total_count: number;
  total_pages: number;
  total_bytes: number;
  categories: EhCategoryMetric[];
}

export type MessageKind = 'info' | 'err' | 'success';
export interface UiMessage {
  kind: MessageKind;
  text: string;
}
