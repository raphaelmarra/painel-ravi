// Copia consistente de bancos SQLite com o banco aberto: VACUUM INTO.
// Uso: bun sqlite-backup.js <pasta-destino> <arquivo.db>...
const { Database } = require("bun:sqlite");
const path = require("path");
const [out, ...files] = process.argv.slice(2);
for (const f of files) {
  const dst = path.join(out, path.basename(f));
  new Database(f, { readonly: true }).exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  console.log("ok", dst);
}
