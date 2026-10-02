// Lihat isi folder sumber produksi via klien Drive aplikasi (read-only).
process.env.DISABLE_SCHEDULER = '1';
const root = '/www/wwwroot/video.dymas.cloud/server/dist';
const { settings } = await import(`${root}/modules/settings/service.js`);
const { listChildren, about } = await import(`${root}/modules/drive/client.js`);
const { closeDb } = await import(`${root}/db.js`);
await settings.load();
console.log('akun:', (await about()).user);
const rootId = settings.get('drive.root_folder_id');
const walk = async (id, depth) => {
  for await (const page of listChildren(id)) {
    for (const f of page) {
      console.log(`${'  '.repeat(depth)}- ${f.name}  [${f.mimeType}${f.size ? `, ${(Number(f.size) / 1048576).toFixed(1)} MB` : ''}]${f.appProperties?.dvRole ? ` (dvRole=${f.appProperties.dvRole})` : ''}`);
      if (f.mimeType === 'application/vnd.google-apps.folder' && depth < 3) await walk(f.id, depth + 1);
    }
  }
};
console.log(`folder sumber: ${settings.get('drive.root_folder_name')} (${rootId})`);
await walk(rootId, 1);
await closeDb();
