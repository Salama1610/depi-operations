import { actor,all,stmt } from '@/lib/server';
import { ensure } from '@/lib/domain/rules';
export async function GET(){try{const u=await actor();return Response.json({notifications:await all('SELECT * FROM notifications WHERE recipient=? ORDER BY created_at DESC LIMIT 100',u.id)});}catch(e:any){return Response.json({error:e.message},{status:403})}}
export async function POST(req:Request){try{const u=await actor();ensure(!req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin,'Cross-site action rejected.');const x=await req.json();await stmt('UPDATE notifications SET read_at=? WHERE id=? AND recipient=?',new Date().toISOString(),x.id,u.id).run();return Response.json({ok:true})}catch(e:any){return Response.json({error:e.message},{status:400})}}
