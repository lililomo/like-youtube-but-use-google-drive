import { badRequest } from '../../lib/errors.js';
import { settings } from '../settings/service.js';
import { isFolder, isIgnoredFolder, isSubtitleFile, isVideoFile, RENDITIONS_FOLDER_NAME, SYSTEM_FOLDER_NAME } from './classify.js';
import { createFolder, DriveError, findChildFolder, getFile, getStartPageToken, isDriveConfigured, listChildren } from './client.js';

export interface FolderStats {
  folder: { id: string; name: string };
  videoCount: number;
  subfolderCount: number;
  subtitleCount: number;
  truncated: boolean;
}

/** Validasi folder: harus folder, tidak di trash, bisa ditulis (untuk upload). */
export async function inspectFolder(folderId: string) {
  let file;
  try {
    file = await getFile(folderId);
  } catch (err) {
    if (err instanceof DriveError && (err.status === 404 || err.status === 403)) {
      throw badRequest('Folder tidak ditemukan atau akun Google ini tidak punya akses ke folder tersebut');
    }
    throw err;
  }
  if (!isFolder(file)) throw badRequest('ID tersebut bukan folder Google Drive');
  if (file.trashed) throw badRequest('Folder berada di Trash');
  if (file.capabilities && file.capabilities.canListChildren === false) throw badRequest('Tidak punya izin melihat isi folder');
  if (file.capabilities && file.capabilities.canAddChildren === false) {
    throw badRequest('Akun ini tidak punya izin menambah file ke folder (dibutuhkan untuk upload). Beri akses Editor.');
  }
  return file;
}

/** Hitung isi folder (rekursif bila includeSubfolders), dibatasi waktu & jumlah agar cepat. */
export async function folderStats(folderId: string, opts: { includeSubfolders: boolean; maxItems?: number; maxMs?: number }): Promise<FolderStats> {
  const root = await inspectFolder(folderId);
  const allowed = settings.get('upload.allowed_ext');
  const maxItems = opts.maxItems ?? 20_000;
  const deadline = Date.now() + (opts.maxMs ?? 25_000);
  const queue = [folderId];
  let videoCount = 0;
  let subfolderCount = 0;
  let subtitleCount = 0;
  let seen = 0;
  let truncated = false;

  outer: while (queue.length) {
    const id = queue.shift()!;
    for await (const page of listChildren(id)) {
      for (const f of page) {
        seen++;
        if (isFolder(f)) {
          if (isIgnoredFolder(f)) continue;
          subfolderCount++;
          if (opts.includeSubfolders) queue.push(f.id);
        } else if (isVideoFile(f, allowed)) videoCount++;
        else if (isSubtitleFile(f)) subtitleCount++;
      }
      if (seen >= maxItems || Date.now() > deadline) {
        truncated = true;
        break outer;
      }
    }
  }
  return { folder: { id: root.id, name: root.name }, videoCount, subfolderCount, subtitleCount, truncated };
}

/** Temukan/buat folder sistem `_dymasvideo_system/renditions` di dalam folder root. */
export async function ensureSystemFolders(rootId: string): Promise<{ systemId: string; renditionsId: string }> {
  const system =
    (await findChildFolder(rootId, SYSTEM_FOLDER_NAME)) ?? (await createFolder(SYSTEM_FOLDER_NAME, rootId, { dv: '1', dvRole: 'system' }));
  const renditions =
    (await findChildFolder(system.id, RENDITIONS_FOLDER_NAME)) ??
    (await createFolder(RENDITIONS_FOLDER_NAME, system.id, { dv: '1', dvRole: 'system' }));
  return { systemId: system.id, renditionsId: renditions.id };
}

/** Simpan folder sumber: validasi, folder sistem, start page token. */
export async function configureRootFolder(folderId: string) {
  const file = await inspectFolder(folderId);
  const previous = settings.get('drive.root_folder_id');
  await settings.set({ 'drive.shared_drive_id': file.driveId ?? null });
  const { systemId, renditionsId } = await ensureSystemFolders(file.id);
  const pageToken = await getStartPageToken();
  await settings.set({
    'drive.root_folder_id': file.id,
    'drive.root_folder_name': file.name,
    'drive.system_folder_id': systemId,
    'drive.renditions_folder_id': renditionsId,
    'drive.changes_page_token': pageToken,
    'drive.last_sync_error': null,
  });
  return { folder: { id: file.id, name: file.name }, sharedDriveId: file.driveId ?? null, changed: previous !== file.id };
}

export function driveStatus() {
  const mode = settings.get('drive.auth_mode');
  return {
    authMode: mode,
    configured: isDriveConfigured(),
    connectedEmail: mode === 'service_account' ? settings.get('drive.service_account_email') : settings.get('drive.connected_email'),
    oauth: {
      clientId: settings.get('drive.oauth_client_id'),
      clientSecretConfigured: settings.hasSecret('drive.oauth_client_secret'),
      refreshTokenConfigured: settings.hasSecret('drive.oauth_refresh_token'),
    },
    serviceAccount: {
      configured: settings.hasSecret('drive.service_account_json'),
      email: settings.get('drive.service_account_email'),
    },
    folder: settings.get('drive.root_folder_id')
      ? { id: settings.get('drive.root_folder_id'), name: settings.get('drive.root_folder_name') }
      : null,
    sharedDriveId: settings.get('drive.shared_drive_id'),
    systemFolderId: settings.get('drive.system_folder_id'),
    includeSubfolders: settings.get('drive.include_subfolders'),
    syncIntervalSec: settings.get('drive.sync_interval_sec'),
    fullSyncIntervalMin: settings.get('drive.full_sync_interval_min'),
    lastSyncAt: settings.get('drive.last_sync_at'),
    lastFullSyncAt: settings.get('drive.last_full_sync_at'),
    lastSyncError: settings.get('drive.last_sync_error'),
  };
}
