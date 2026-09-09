import {actor,all,rateLimit,scopeSql} from '@/lib/server';
import {can,ensure} from '@/lib/domain/rules';

export async function GET(req:Request){
  try{
    const u=await actor();
    await rateLimit('search:'+u.id,60,60);
    const text=(new URL(req.url).searchParams.get('q')||'').trim();
    ensure(text.length>=2&&text.length<=80,'Enter between 2 and 80 characters.');
    const like='%'+text.replaceAll('%','\\%').replaceAll('_','\\_')+'%';
    const q=scopeSql(u);
    const [students,groups,gigs,evidence,cases,accounts]=await Promise.all([
      all(`SELECT 'student' type,s.id id,s.name label,g.name detail FROM students s JOIN groups g ON g.id=s.group_id WHERE ${q.sql} AND (s.id LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\') ORDER BY s.name LIMIT 8`,...q.args,like,like,like),
      all(`SELECT 'group' type,g.id id,g.name label,g.track||' · '||g.pathway detail FROM groups g WHERE ${q.sql} AND (g.id LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\') ORDER BY g.name LIMIT 6`,...q.args,like,like),
      all(`SELECT 'gig' type,z.id id,z.title label,z.platform||' · '||s.name detail FROM gigs z JOIN students s ON s.id=z.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} AND (z.id LIKE ? ESCAPE '\\' OR z.order_ref LIKE ? ESCAPE '\\' OR z.title LIKE ? ESCAPE '\\') ORDER BY z.created_at DESC LIMIT 6`,...q.args,like,like,like),
      all(`SELECT 'evidence' type,e.id id,e.status label,s.name detail FROM evidence e JOIN students s ON s.id=e.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} AND e.id LIKE ? ESCAPE '\\' ORDER BY e.created_at DESC LIMIT 5`,...q.args,like),
      all(`SELECT 'case' type,c.id id,c.title label,c.status||coalesce(' · '||s.name,'') detail FROM cases c LEFT JOIN students s ON s.id=c.student_id LEFT JOIN groups g ON g.id=s.group_id WHERE (${q.sql}) AND (c.id LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\') ORDER BY c.created_at DESC LIMIT 5`,...q.args,like,like),
      can(u.roles,['Higher Board','Project Operations','Operations Systems / Admin'])?all(`SELECT 'account' type,id,label,platform||' · '||status detail FROM accounts WHERE id LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\' ORDER BY id LIMIT 5`,like,like):Promise.resolve([])
    ]);
    return Response.json({results:[...students,...groups,...gigs,...evidence,...cases,...accounts].slice(0,30)},{headers:{'Cache-Control':'private,no-store'}});
  }catch(e:any){return Response.json({error:e.message},{status:400});}
}
