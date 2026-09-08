import { policy as baseline } from './rules';
export type PolicyAction={kind:'task'|'case';student_id:string;owner:string;title:string;category?:string;priority?:string;type?:string;severity?:string;due:string;source:string};
/** Pure, replayable planning. Applying a plan is an authenticated service operation. */
export function planPolicyActions(data:any,at=Date.now()):PolicyAction[]{
 const planned:PolicyAction[]=[];const tasks=data.tasks||[],cases=data.cases||[];
 const due=(hours:number)=>new Date(at+hours*3600000).toISOString();
 for(const s of data.students){if(s.lifecycle!=='Active')continue;
 const p=s.policy||baseline;const owned=tasks.filter((t:any)=>t.student_id===s.id);
 if(s.contact_due&&!owned.some((t:any)=>t.status==='Open'&&['Contact','Follow-up'].includes(t.category))){const previous=owned.filter((t:any)=>t.category==='Contact').length;planned.push({kind:'task',student_id:s.id,owner:s.coordinator,title:'Complete overdue student contact with screenshot proof',category:'Contact',priority:'High',due:due(24),source:`policy-contact:${s.id}:${s.policy_id}:${s.last_contact||'never'}:${previous}`});}
 if(s.risk.status==='At Risk'&&!owned.some((t:any)=>t.status==='Open'&&t.category==='Recovery')){planned.push({kind:'task',student_id:s.id,owner:s.coordinator,title:'Recovery plan: '+s.risk.reasons.join('; '),category:'Recovery',priority:'High',due:due(24),source:`policy-recovery:${s.id}:${s.policy_id}:${owned.filter((t:any)=>t.category==='Recovery').length}`});}
 if(s.risk.status==='Critical'&&!cases.some((c:any)=>c.student_id===s.id&&c.source?.startsWith('policy-critical:')&&c.status!=='Closed')){planned.push({kind:'case',student_id:s.id,owner:s.supervisor,title:'Supervisor intervention: '+s.risk.reasons.join('; '),type:'Student',severity:'S2 High',due:due(24),source:`policy-critical:${s.id}:${s.policy_id}:${cases.filter((c:any)=>c.student_id===s.id&&c.source?.startsWith('policy-critical:')).length}`});}
 }
 for(const e of data.evidence||[]){const s=data.students.find((s:any)=>s.id===e.student_id);if(!s||s.lifecycle!=='Active')continue;const p=e.applied_policy||s.policy||baseline;const hours=e.status==='Coach Review'?p.coachHours:e.status==='Coordinator L1'?p.l1Hours:e.status==='Quality Review'?p.qualityHours:null;if(hours===null||at-Date.parse(e.stage_at)<=hours*3600000)continue;
 const source=`policy-sla:${e.id}:${e.status}:${e.stage_at}`;if(tasks.some((t:any)=>t.source===source))continue;
 const role=e.status==='Coach Review'?'Coach Operations':e.status==='Quality Review'?'Quality Lead':null;
 const lead=role?(data.staff||[]).filter((u:any)=>u.active&&JSON.parse(u.roles).includes(role)).sort((a:any,b:any)=>a.id.localeCompare(b.id))[0]:null;
 planned.push({kind:'task',student_id:s.id,owner:lead?.id||s.supervisor,title:`Escalate ${e.status} SLA breach: ${e.id}`,category:'SLA escalation',priority:'Urgent',due:due(24),source});
 }
 return planned;
}
