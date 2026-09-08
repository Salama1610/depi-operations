import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {build} from 'esbuild';
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let current={id:'owner',email:'owner@example.com'};
const query=(sql,args=[])=>({sql,args,bind(...v){return query(sql,v)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:r.changes}}}});
globalThis.__testEnv={DB:{prepare:query,async batch(jobs){sqlite.exec('BEGIN');try{const r=[];for(const j of jobs)r.push(/^SELECT/i.test(j.sql.trim())?await j.all():await j.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}},BUCKET:{}};
globalThis.__testHeaders=()=>new Headers({'oai-authenticated-user-id':current.id,'oai-authenticated-user-email':current.email});
await build({entryPoints:['app/api/operations/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/depi-operations-test.mjs',plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__testEnv':'export const headers=async()=>globalThis.__testHeaders()',loader:'js'}))}}]});
const api=await import('/tmp/depi-operations-test.mjs');const post=async(action,x={})=>{const r=await api.POST(new Request('https://test.local/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...x})}));return await r.json()};
const check=async(action,x={})=>{const r=await post(action,x);assert.equal(r.error,undefined,r.error);return r};
test('full seeded backend workflow and permission gates',async()=>{
 await check('setup');assert.equal(sqlite.prepare('SELECT count(*) n FROM students').get().n,1000);assert.equal(sqlite.prepare('SELECT count(*) n FROM tasks').get().n,1000);
 const data=await (await api.GET()).json();assert.equal(data.students.length,1000);assert.equal(data.students[0].graduation,'0/3');assert.ok(data.students[0].next_task);
 let r=await post('contact',{student_id:'S10001'});assert.match(r.error,/incomplete/);
 sqlite.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)').run('PROOF-1','S10001','key1','proof.png','image/png',100,'hash1','owner',new Date().toISOString());
 const c={student_id:'S10001',outcome:'Responded',proof_id:'PROOF-1',next_action:'Next contact',owner:'owner',due:'2027-01-01T00:00:00Z',occurred_at:new Date().toISOString(),channel:'WhatsApp',request_id:'contact-once'};
 await check('contact',c);await check('contact',c);assert.equal(sqlite.prepare("SELECT count(*) n FROM contacts WHERE student_id='S10001'").get().n,1);
 await check('account_request',{id:'REQ1',student_id:'S10001',task:'Banner',platform:'Khamsat',value:5});
 r=await post('allocate',{request:'REQ1',account:'ACC-102',task_fit:true});assert.match(r.error,/role/);
 await check('staff',{name:'Owner',email:'owner@example.com',roles:['Project Operations','Operations Systems / Admin','Higher Board'],reason:'Explicit test allocation role'});
 await check('allocate',{request:'REQ1',account:'ACC-102',task_fit:true});assert.equal(sqlite.prepare("SELECT status FROM accounts WHERE id='ACC-102'").get().status,'Assigned');
 await check('account_request',{id:'REQ2',student_id:'S10026',task:'Banner two',platform:'Khamsat',value:5});r=await post('allocate',{request:'REQ2',account:'ACC-102',task_fit:true});assert.match(r.error,/unavailable|assigned/);
 const gig=sqlite.prepare("SELECT * FROM gigs WHERE student_id='S10001'").get();r=await post('gig_transition',{id:gig.id,status:'Paid',proof_id:'PROOF-1',occurred_at:new Date().toISOString()});assert.match(r.error,/transition/);
 for(const status of ['Gig Opened','Work Submitted','Delivered','Paid'])await check('gig_transition',{id:gig.id,status,proof_id:'PROOF-1',occurred_at:new Date().toISOString()});
 await check('evidence',{id:'EV1',gig_id:gig.id,proof_id:'PROOF-1',source:'WhatsApp'});
 r=await post('review',{id:'EV1',notes:'Looks complete'});assert.match(r.error,/role/);
 current={id:'coach-login',email:'staff-coach@example.invalid'};await check('review',{id:'EV1',notes:'Coach confirms delivery'});
 current={id:'owner',email:'owner@example.com'};await check('review',{id:'EV1',notes:'Completeness checked'});
 r=await post('review',{id:'EV1',decision:'Accept',notes:'Approve'});assert.match(r.error,/role/);
 current={id:'quality-login',email:'staff-quality@example.invalid'};await check('review',{id:'EV1',decision:'Reject',code:'EV01',notes:'Need delivery screenshot',request_id:'reject-once'});await check('review',{id:'EV1',decision:'Reject',code:'EV01',notes:'Need delivery screenshot',request_id:'reject-once'});assert.equal(sqlite.prepare("SELECT count(*) n FROM tasks WHERE category='Correction'").get().n,1);
 current={id:'owner',email:'owner@example.com'};await check('review',{id:'EV1',proof_id:'PROOF-1',notes:'Corrected package'});
 current={id:'quality-login',email:'staff-quality@example.invalid'};await check('review',{id:'EV1',decision:'Accept',notes:'All seven checks passed',checklist:['Completeness','Identity','Delivery','Payment/value','Authenticity','Source consistency','Duplicate checks']});
 assert.equal(sqlite.prepare("SELECT status FROM evidence WHERE id='EV1'").get().status,'Accepted');assert.equal(sqlite.prepare("SELECT result FROM graduation_ledger WHERE student_id='S10001' ORDER BY rowid DESC LIMIT 1").get().result,'1/3');
 current={id:'coordinator-login',email:'staff-omar@example.invalid'};r=await post('contact',c);assert.ok(r.error);r=await post('review',{id:'EV1',decision:'Reopen',notes:'Unauthorized'});assert.ok(r.error);
 assert.throws(()=>sqlite.exec("UPDATE audit_events SET action='tampered'"),/immutable/);assert.throws(()=>sqlite.exec('DELETE FROM evidence_reviews'),/immutable/);
});
test('database allocation guard protects stale concurrent eligibility',()=>{const now=new Date().toISOString();assert.throws(()=>sqlite.prepare('INSERT INTO account_assignments VALUES(?,?,?,?,?,?)').run('ASN-late','ACC-102','S10026','G102','REQ2',now),/eligibility/)});
test('policy versions require separate approval and apply to new groups',async()=>{
 current={id:'owner',email:'owner@example.com'};
 await check('policy',{id:'P2',name:'Round 5 test policy',config:{contactDays:3,failedAttempts:3,failedWindowDays:7},reason:'Test configurable thresholds'});
 await check('policy_edit',{id:'P2',config:{contactDays:2,failedAttempts:3,failedWindowDays:7},reason:'Tighten contact cadence'});
 await check('policy_transition',{id:'P2',status:'Reviewed',reason:'Reviewed the change'});
 assert.match((await post('policy_transition',{id:'P2',status:'Approved',reason:'Self approval'})).error,/different/);
 await check('staff',{name:'Independent approver',email:'approver@example.com',roles:['Project Operations'],reason:'Independent policy approver'});
 current={id:'approver',email:'approver@example.com'};await check('policy_transition',{id:'P2',status:'Approved',reason:'Independently approved'});await check('policy_transition',{id:'P2',status:'Effective',reason:'Effective for new groups'});
 current={id:'owner',email:'owner@example.com'};assert.match((await post('policy_edit',{id:'P2',config:{contactDays:1},reason:'Try changing effective policy'})).error,/draft/);
 await check('group',{id:'GNEW',name:'New policy group',track:'Design',provider:'Career180',coordinator:'staff-sara',supervisor:'staff-nour',coach:'staff-coach',pathway:'Outcome',start_date:'2026-09-01',policy_id:'P2'});
 assert.equal(sqlite.prepare("SELECT policy_id FROM groups WHERE id='GNEW'").get().policy_id,'P2');assert.equal(sqlite.prepare("SELECT policy_id FROM groups WHERE id='G101'").get().policy_id,'R5-v1');
});
test('policy checks create recovery and supervisor actions without duplicates',async()=>{
 current={id:'owner',email:'owner@example.com'};
 let first=await check('policy_check');assert.ok(first.summary.processed>0);let runs=1;while(first.summary.remaining>0){assert.ok(runs++<30,'Policy batches must converge');first=await check('policy_check');}
 const n=sqlite.prepare("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'").get().n;const c=sqlite.prepare("SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'").get().n;assert.ok(c>0);
 const second=await check('policy_check');assert.equal(second.summary.processed,0);assert.equal(sqlite.prepare("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'").get().n,n);assert.equal(sqlite.prepare("SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'").get().n,c);
 current={id:'coordinator',email:'staff-sara@example.invalid'};assert.match((await post('policy_check')).error,/role/);
});
async function route(name){const output='/tmp/depi-route-'+name+'.mjs';await build({entryPoints:['app/api/'+name+'/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__testEnv':'export const headers=async()=>globalThis.__testHeaders()',loader:'js'}))}}]});return import(output)}
test('signed automation rejects tampering and replays without duplicate execution',async()=>{
 const {createHash,createHmac}=await import('node:crypto');globalThis.__testEnv.AUTOMATION_HMAC_SECRET='test-only-secret-0000000000000000000000';globalThis.__testEnv.AUTOMATION_ACTOR_EMAIL='owner@example.com';const api=await route('automation');
 async function call(body,event='machine-test-0001',old=false){const timestamp=String(Date.now()-(old?600000:0));const signature=createHmac('sha256',globalThis.__testEnv.AUTOMATION_HMAC_SECRET).update(timestamp+'\n'+event+'\n'+createHash('sha256').update(body).digest('hex')).digest('hex');return api.POST(new Request('https://test.local/api/automation',{method:'POST',headers:{'x-depi-timestamp':timestamp,'x-depi-event-id':event,'x-depi-signature':signature},body}))}
 const body=JSON.stringify({action:'weekly_report'});let r=await (await call(body)).json();assert.equal(r.ok,true);r=await(await call(body)).json();assert.equal(r.replayed,true);r=await(await call(JSON.stringify({action:'policy_check'}))).json();assert.match(r.error,/different contents/);r=await(await call(body,'machine-expired-1',true)).json();assert.match(r.error,/expired/);
});
test('notifications are recipient-scoped and preserve read state',async()=>{
 const api=await route('notifications');current={id:'coordinator',email:'staff-sara@example.invalid'};let result=await(await api.GET()).json();assert.ok(result.notifications.length>0);const n=result.notifications[0];await api.POST(new Request('https://test.local/api/notifications',{method:'POST',body:JSON.stringify({id:n.id})}));result=await(await api.GET()).json();assert.ok(result.notifications.find(x=>x.id===n.id).read_at);current={id:'other',email:'staff-omar@example.invalid'};result=await(await api.GET()).json();assert.ok(!result.notifications.some(x=>x.id===n.id));
});
test('vault access is role restricted and never logs returned credentials',async()=>{
 const api=await route('credentials');const call=x=>api.POST(new Request('https://test.local/api/credentials',{method:'POST',body:JSON.stringify(x)}));current={id:'coordinator',email:'staff-sara@example.invalid'};let result=await(await call({action:'reveal',account_id:'ACC-102',purpose:'Resolve the assigned client task'})).json();assert.match(result.error,/role/);
 current={id:'owner',email:'owner@example.com'};await call({action:'set_reference',account_id:'ACC-102',purpose:'Connect the approved account vault',reference:'depi/test-account'});globalThis.__testEnv.VAULT_URL='https://vault.example.invalid/secrets';globalThis.__testEnv.VAULT_TOKEN='test-token';const realFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({username:'test-user',password:'test-secret-never-log'});try{result=await(await call({action:'reveal',account_id:'ACC-102',purpose:'Resolve the assigned client task'})).json();assert.equal(result.password,'test-secret-never-log');assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_events WHERE value LIKE '%test-secret-never-log%'").get().n,0);}finally{globalThis.fetch=realFetch}
});
test('encrypted database and evidence backup restores to a fresh isolated directory',async()=>{
 const {createHash}=await import('node:crypto');const {execFileSync}=await import('node:child_process');const os=await import('node:os');const path=await import('node:path');const bytes=new TextEncoder().encode('synthetic evidence bytes for restore test');sqlite.prepare("UPDATE attachments SET size=?,hash=? WHERE id='PROOF-1'").run(bytes.length,createHash('sha256').update(bytes).digest('hex'));globalThis.__testEnv.BUCKET.get=async()=>({body:new Response(bytes).body});globalThis.__testEnv.BACKUP_ENCRYPTION_KEY='11'.repeat(32);current={id:'owner',email:'owner@example.com'};const api=await route('backup');const response=await api.POST(new Request('https://test.local/api/backup',{method:'POST'}));assert.equal(response.status,200);const archive=new Uint8Array(await response.arrayBuffer());assert.ok(archive.length>1000);const folder=fs.mkdtempSync(path.join(os.tmpdir(),'depi-restore-'));const zip=path.join(folder,'backup.zip'),out=path.join(folder,'restored');fs.writeFileSync(zip,archive);const log=execFileSync(process.execPath,['scripts/restore/restore-backup.mjs',zip,out],{env:{...process.env,BACKUP_ENCRYPTION_KEY:globalThis.__testEnv.BACKUP_ENCRYPTION_KEY},encoding:'utf8'});assert.match(log,/Restore verified/);const restored=new DatabaseSync(path.join(out,'database.sqlite'));assert.equal(restored.prepare('SELECT count(*) n FROM students').get().n,1000);assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);assert.throws(()=>restored.exec("UPDATE audit_events SET action='tamper'"),/immutable/);restored.close();assert.deepEqual(fs.readFileSync(path.join(out,'evidence','PROOF-1')),Buffer.from(bytes));
});
