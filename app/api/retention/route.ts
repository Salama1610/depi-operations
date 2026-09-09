import {actor,all,auditStmt,db,now,permit,rateLimit,stmt,uid} from '@/lib/server';
import {ensure} from '@/lib/domain/rules';

const scopes=['audit_events','attachments','notifications','automation_runs','imports','exports'];
const actions=['archive','anonymize','secure_delete'];

export async function GET(){
  try{
    const u=await actor();permit(u,['Operations Systems / Admin']);await rateLimit('retention:'+u.id,60,60);
    const configurations=await all("SELECT key,value,classification,updated_by,updated_at FROM system_configuration WHERE key LIKE 'retention:%' ORDER BY key");
    const history=await all('SELECT * FROM retention_actions ORDER BY created_at DESC LIMIT 50');
    return Response.json({configurations,history,notice:'Execution remains disabled until an approved organizational/legal period is configured for the exact data scope.'},{headers:{'Cache-Control':'private,no-store'}});
  }catch(e:any){return Response.json({error:e.message},{status:403});}
}

export async function POST(req:Request){
  try{
    const u=await actor();permit(u,['Operations Systems / Admin']);await rateLimit('retention:'+u.id,20,60);
    ensure(!req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin,'Cross-site action rejected.');
    const x=await req.json();
    ensure(scopes.includes(x.scope)&&actions.includes(x.retention_action)&&Number.isInteger(+x.days)&&+x.days>=1&&+x.days<=36500&&x.authority?.trim()&&x.reason?.trim(),'Scope, approved action, period, authority and reason are required.');
    const key='retention:'+x.scope,value={days:+x.days,action:x.retention_action,authority:x.authority,approved_at:now()};
    const id=uid('RET');
    await db().batch([
      stmt('INSERT INTO system_configuration(key,value,classification,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,classification=excluded.classification,updated_by=excluded.updated_by,updated_at=excluded.updated_at',key,JSON.stringify(value),'Restricted',u.id,now()),
      stmt('INSERT INTO retention_actions(id,scope,cutoff,action,status,reason,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?)',id,x.scope,new Date(Date.now()-+x.days*86400000).toISOString(),x.retention_action,'Policy recorded — execution pending',x.reason,u.id,now()),
      auditStmt(u,'Retention policy recorded',key,value,null,uid('REQ'),x.reason)
    ]);
    return Response.json({ok:true,id,execution_status:'pending'});
  }catch(e:any){return Response.json({error:e.message},{status:400});}
}
