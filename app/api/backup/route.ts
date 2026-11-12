import { failure } from "@/lib/errors";
import { env } from "@/lib/env";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { actor, permit, stmt, bucket, auditStmt, uid, now, rateLimit, refuseDemo } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { backupTables, backupKey, encryptPart } from "@/lib/domain/backup";

// The administrators' encrypted backup: every table and every stored file, in
// one zip, each part AES-256-GCM encrypted with the backup key
// (scripts/restore/restore-backup.mjs restores it into a fresh directory).
//
// Format v2 (12 November 2026): each table is its own part, read in pages and
// streamed, so a backup no longer refuses once a table passes 20,000 rows or
// the database passes 16 MB, which attendance, contacts and the audit trail
// were about to. The manifest comes last, with every table's row count.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const page = 5000;

/** Every row of a table, a page at a time, in a stable order. */
async function readTable(table: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += page) {
    const chunk = (await stmt(`SELECT * FROM ${table} ORDER BY 1 LIMIT ${page} OFFSET ${offset}`).all()).results as any[];
    rows.push(...chunk);
    if (chunk.length < page) return rows;
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    await rateLimit("backup:" + u.id, 2, 3600);
    permit(u, ["Operations Systems / Admin"]);
    ensure(!req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin, "Cross-site backup rejected.");
    const key = await backupKey(env.BACKUP_ENCRYPTION_KEY || "");
    // The stored files are listed from the attachments table, read first.
    const attachments = await readTable("attachments");
    const id = uid("BACKUP");
    const createdAt = now();
    await auditStmt(u, "Encrypted backup export started", id, { files: attachments.length, format: "depi-backup-v2" }).run();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const zip = new Zip((error, data, final) => {
          if (error) {
            controller.error(error);
            return;
          }
          if (!cancelled) controller.enqueue(data);
          if (final && !cancelled) controller.close();
        });
        const add = (name: string, data: Uint8Array) => {
          const part = new ZipPassThrough(name);
          zip.add(part);
          part.push(data, true);
        };
        // Waits while the reader is behind, so the whole backup is never held in memory.
        const drain = async () => {
          while ((controller.desiredSize ?? 0) <= 0 && !cancelled) await new Promise((r) => setTimeout(r, 25));
        };
        (async () => {
          try {
            const counts: Record<string, number> = {};
            for (const table of backupTables) {
              if (cancelled) return;
              await drain();
              const rows = table === "attachments" ? attachments : await readTable(table);
              counts[table] = rows.length;
              const entry = `tables/${table}.enc`;
              add(entry, await encryptPart(key, strToU8(JSON.stringify(rows)), entry));
            }
            for (const a of attachments) {
              if (cancelled) return;
              await drain();
              const obj = await bucket().get(a.key);
              ensure(obj, "Backup could not read evidence " + a.id);
              const data = new Uint8Array(await new Response(obj.body).arrayBuffer());
              ensure(data.length === a.size, "Evidence size mismatch: " + a.id);
              const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
                .map((v) => v.toString(16).padStart(2, "0"))
                .join("");
              ensure(hash === a.hash, "Evidence checksum mismatch: " + a.id);
              add("objects/" + a.id + ".enc", await encryptPart(key, data, "objects/" + a.id + ".enc"));
            }
            const manifest = {
              format: "depi-backup-v2",
              created_at: createdAt,
              encryption: "AES-256-GCM; first 12 bytes IV; ZIP entry name is authenticated data",
              tables: counts,
              files: attachments.map((a: any) => ({ id: a.id, key: a.key, name: a.name, size: a.size, hash: a.hash, entry: "objects/" + a.id + ".enc" })),
            };
            add("manifest.enc", await encryptPart(key, strToU8(JSON.stringify(manifest)), "manifest.enc"));
            await auditStmt(u, "Encrypted backup export generated", id, { files: attachments.length, rows: Object.values(counts).reduce((n, c) => n + c, 0) }).run();
            zip.end();
          } catch (e) {
            if (!cancelled) controller.error(e);
          }
        })();
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="depi-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "private,no-store",
      },
    });
  } catch (e: any) {
    return failure(e, "backup");
  }
}
