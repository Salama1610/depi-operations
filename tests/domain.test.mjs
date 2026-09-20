import test from 'node:test';
import assert from 'node:assert/strict';
import { graduation,validateContact,nextGig,can,risk,csvCell,policy } from '../lib/domain/rules.ts';
const gig=(value,status='Accepted')=>({status,gig_status:'Paid',currency:'USD',value});
test('graduation uses only accepted paid qualifying gigs',()=>{assert.equal(graduation([gig(5),gig(5),gig(5)]),'Graduated');assert.equal(graduation([gig(5),gig(5),gig(4)]),'2/3');assert.equal(graduation([gig(300,'Quality Review')]),'0/3');assert.equal(graduation([gig(300)]),'$300 Graduate');assert.equal(graduation([{...gig(300),gig_status:'Delivered'}]),'0/3');assert.equal(graduation([{...gig(300),currency:'EGP'}]),'0/3')});
test('non-USD graduation requires a stored approved conversion value',()=>{const egp={...gig(300),currency:'EGP'};assert.equal(graduation([egp]),'0/3');assert.equal(graduation([{...egp,usd_value:6}]),'1/3');assert.equal(graduation([{...egp,usd_value:300}]),'$300 Graduate')});
test('proof and next action cannot be omitted from completed contact',()=>{const c={student_id:'S1',outcome:'Responded',proof_id:'A1',next_action:'Check progress',owner:'U1',due:'2027-01-01',occurred_at:'2026-01-01',channel:'WhatsApp'};validateContact(c);for(const k of ['proof_id','outcome','next_action','owner','due'])assert.throws(()=>validateContact({...c,[k]:''}));});
test('client activity rejects invalid skips and absent screenshots',()=>{assert.throws(()=>nextGig('Gig Opened','Paid',true));assert.throws(()=>nextGig('Delivered','Paid',false));nextGig('Delivered','Paid',true);assert.throws(()=>nextGig('Cancelled','Paid',true));});
test('admin is not implicitly a quality approver',()=>{assert.equal(can(['Operations Systems / Admin'],['Quality Member','Quality Lead']),false);assert.equal(can(['Operations Coordinator'],['Higher Board']),false)});
test('missing contact does not itself imply unresponsive',()=>{assert.equal(risk({last_contact:null,milestone:4},4,null,0,0).status,'At Risk');assert.equal(risk({last_contact:null,milestone:4},4,null,5,0).status,'Critical');});
test('spreadsheet export neutralizes formula injection',()=>assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"'));
import {validatePolicy} from '../lib/domain/rules.ts';
import {verifyServiceLink,normalizeServiceSlots} from '../lib/domain/service-links.ts';
test('policy rejects invalid percentages, inverted thresholds and fractional counts',()=>{assert.throws(()=>validatePolicy({target:110}));assert.throws(()=>validatePolicy({criticalAttendance:80,riskAttendance:70}));assert.throws(()=>validatePolicy({gigCount:2.5}));assert.throws(()=>validatePolicy({sessionMinutes:179.5}));assert.throws(()=>validatePolicy({unknown:5}));assert.equal(validatePolicy({contactDays:3}).contactDays,3)});
test('service links accept only direct service pages on the approved marketplaces',()=>{const k=verifyServiceLink('https://www.kafiil.com/service/123-arabic-%D8%AE%D8%AF%D9%85%D8%A9?utm_source=x#top');assert.equal(k.status,'Needs Review');assert.equal(k.normalizedUrl,'https://kafiil.com/service/123-arabic-%D8%AE%D8%AF%D9%85%D8%A9');assert.equal(k.serviceId,'123');const upgraded=verifyServiceLink('http://kafiil.com/service/123-service');assert.equal(upgraded.status,'Needs Review');assert.equal(upgraded.normalizedUrl,'https://kafiil.com/service/123-service');assert.equal(verifyServiceLink('http://example.com/service/123-service').status,'Failed');const nafezly=verifyServiceLink('https://nafezly.com/service/56713-%D8%AA%D8%B5%D9%85%D9%8A%D9%85-powerpoint');assert.equal(nafezly.status,'Needs Review');assert.equal(nafezly.platform,'Nafezly');assert.equal(nafezly.serviceId,'56713');assert.equal(verifyServiceLink('https://nafezly.com/about').status,'Failed');assert.equal(verifyServiceLink('https://example.com/service/123-service').status,'Failed');assert.equal(verifyServiceLink('https://127.0.0.1/service/123-service').status,'Failed');assert.equal(verifyServiceLink('https://khamsat.com/design/logo/987-logo-design').status,'Needs Review');assert.equal(verifyServiceLink('https://khamsat.com/design/logo/no-id').status,'Failed');});
test('service slots reject duplicates after tracking parameters are removed',()=>assert.throws(()=>normalizeServiceSlots(['https://kafiil.com/service/1-logo?x=1','https://kafiil.com/service/1-logo?x=2','https://khamsat.com/a/b/3-c']),/different/));

test('a student nobody has contacted yet is not at risk inside the first contact window',()=>{
  const p={...policy,contactDays:7,journeyDelayedLag:1,riskAttendance:70,criticalAttendance:50,failedAttempts:5,journeyCriticalLag:2};
  const day=86400000;
  // joined 3 days ago, on milestone, never contacted: nothing is late yet
  assert.equal(risk({last_contact:null,milestone:1,created_at:new Date(Date.now()-3*day).toISOString()},1,null,0,0,p).status,'Active');
  // joined 10 days ago, never contacted: the window has passed
  assert.equal(risk({last_contact:null,milestone:1,created_at:new Date(Date.now()-10*day).toISOString()},1,null,0,0,p).status,'At Risk');
  // no join date keeps the strict reading
  assert.equal(risk({last_contact:null,milestone:1},1,null,0,0,p).status,'At Risk');
});
