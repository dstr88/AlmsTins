// The largest request body the Node server accepts, in bytes (@astrojs/node `bodySizeLimit`).
// Without it the adapter's default is 1 GB, so one huge upload could exhaust the server's memory.
// The largest upload the app itself allows is the 10 MB 1099 PDF (src/pages/api/yearEnd/1099/upload.ts);
// most uploads cap at 5 MB. CSV imports have no cap of their own, so this limit is theirs too.
export const BODY_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
