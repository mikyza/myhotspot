const crypto=require('crypto'), {spawn}=require('child_process');
const BASE='http://127.0.0.1:3111'; let srv;
const start=()=>{ srv=spawn('node',['server.js'],{env:{...process.env,PORT:'3111',PUBLIC_URL:BASE,SESSION_SECRET:'s'.repeat(40),ADMIN_EMAIL:'op@x.com',ADMIN_PASSWORD:'adminpass123',MONGODB_URI:''},stdio:['ignore','pipe','pipe']}); srv.stdout.on('data',()=>{}); srv.stderr.on('data',d=>process.stderr.write(d)); return new Promise(r=>setTimeout(r,1200)); };
const stop=()=>new Promise(r=>{srv.on('exit',r); srv.kill();});
let bad=0; const check=(n,ok,x)=>{console.log((ok?'PASS ':'FAIL ')+n+(ok?'':' '+JSON.stringify(x))); if(!ok) bad++;};
const J=async(path,opt={},ck)=>{const r=await fetch(BASE+path,{...opt,headers:{'Content-Type':'application/json','X-Requested-With':'dash',...(ck?{cookie:ck}:{}),...(opt.headers||{})}}); let j={}; try{j=await r.json()}catch{} return {s:r.status,j,h:r.headers};};
const cookieOf=r=>(r.h.get('set-cookie')||'').split(';')[0];
let ID,KEY;
const sync=async(mid,ops=[],extra={},arch='linux-amd64')=>{
  const ts=String(Math.floor(Date.now()/1000)), body=JSON.stringify({isp_id:ID,batch:1,ops,heartbeat:{version:'2.1.0',host:'shop-pc'}}), sig=crypto.createHmac('sha256',KEY).update(ts+'.'+body).digest('hex');
  const hd={'X-ISP-Id':ID,'X-Timestamp':ts,'X-Signature':sig,'X-App-Arch':arch,...(mid?{'X-Machine-Id':mid}:{})};
  const r=await fetch(BASE+'/api/v1/sync',{method:'POST',headers:{'Content-Type':'application/json',...hd},body}); const raw=await r.text();
  const want=crypto.createHmac('sha256',KEY).update('reply.'+ts+'.'+raw).digest('hex');
  return {s:r.status,j:JSON.parse(raw),signed:r.headers.get('x-reply-signature')===want};
};
const A='m-'+'a'.repeat(32), B='m-'+'b'.repeat(32);
(async()=>{
 await start();
 let r=await J('/api/register',{method:'POST',body:JSON.stringify({business:'Test WiFi',name:'T',email:'t@x.com',phone:'0712345678',password:'password123'})});
 const ck=cookieOf(r); r=await J('/api/isp/connect',{},ck); ID=r.j.isp_id; KEY=r.j.api_key;
 check('no machine bound yet',r.j.machine===null,r.j);
 { // downloads need a sign-in, then stream the real files
   const anon=await fetch(BASE+'/api/isp/download/linux'); check('download blocked when signed out',anon.status===401,anon.status);
   const l=await J('/api/isp/downloads',{},ck); check('download list',l.j.ok&&l.j.items.length===4&&l.j.items.every(i=>i.sha256.length===64&&i.size>1000),l.j);
   const f=await fetch(BASE+'/api/isp/download/windows',{headers:{cookie:ck}}); const buf=Buffer.from(await f.arrayBuffer());
   const item=l.j.items.find(i=>i.key==='windows');
   check('download bytes match the listed hash',f.status===200&&buf.length===item.size&&crypto.createHash('sha256').update(buf).digest('hex')===item.sha256,f.status);
   const bad=await fetch(BASE+'/api/isp/download/..%2Fserver',{headers:{cookie:ck}}); check('download rejects odd names',bad.status===404,bad.status);
   const man=await fetch(BASE+'/manual.html'); check('manual page served',man.status===200&&(await man.text()).includes('Hotspot Billing manual'),man.status);
 }
 const v={op:'upsert',c:'vouchers',id:'C1',data:{code:'C1',status:'unused'}};
 r=await sync(A,[v]); check('first machine binds, ops applied, reply signed',r.j.applied===1&&r.j.license.active&&r.signed,r);
 check('license carries grace fields and max_sites',r.j.license.grace===false&&r.j.license.max_sites===0,r.j.license);
 r=await sync(B,[{...v,id:'C2',data:{code:'C2'}}]); check('second machine refused, nothing stored, signed',r.j.applied===0&&r.j.license.active===false&&r.j.license.code==='machine'&&r.signed,r);
 r=await sync(null); check('old app without machine id is told to update',r.j.license.active===false&&r.j.license.code==='update'&&r.signed,r.j);
 r=await sync('bad'); check('malformed machine id refused',r.j.license.active===false,r.j);
 r=await J('/api/isp/connect',{},ck); check('dashboard shows the bound machine',r.j.machine&&r.j.machine.name==='shop-pc'&&r.j.machine.id_short===A.slice(0,10),r.j.machine);
 r=await J('/api/isp/release-machine',{method:'POST'},ck); check('ISP can release',r.s===200,r);
 r=await J('/api/isp/release-machine',{method:'POST'},ck); check('nothing to release now',r.s===400,r);
 r=await sync(B); check('after release the new machine binds',r.j.license.active===true&&r.signed,r.j);
 r=await J('/api/isp/release-machine',{method:'POST'},ck); check('second release inside 7 days refused',r.s===429,r);
 const adm=await J('/api/login',{method:'POST',body:JSON.stringify({email:'op@x.com',password:'adminpass123'})}); const ac=cookieOf(adm);
 const act=(a,x={})=>J('/api/admin/isps/'+ID+'/action',{method:'POST',body:JSON.stringify({action:a,...x})},ac);
 r=await act('release-machine'); check('operator can release anytime',r.s===200,r);
 r=await sync(A); check('operator release lets A bind again',r.j.license.active===true,r.j);
 { // remote control: queue -> signed sync delivers -> results come back
   const syncX=async(extra)=>{ const ts=String(Math.floor(Date.now()/1000)), body=JSON.stringify({isp_id:ID,ops:[],cmd_poll:true,...extra}), sig=crypto.createHmac('sha256',KEY).update(ts+'.'+body).digest('hex'); const r=await fetch(BASE+'/api/v1/sync',{method:'POST',headers:{'Content-Type':'application/json','X-ISP-Id':ID,'X-Timestamp':ts,'X-Signature':sig,'X-App-Arch':'linux-amd64','X-Machine-Id':A},body}); return JSON.parse(await r.text()); };
   const own=(t,p)=>J('/api/isp/commands',{method:'POST',body:JSON.stringify({type:t,params:p})},ck), op=(t,p)=>J('/api/admin/isps/'+ID+'/commands',{method:'POST',body:JSON.stringify({type:t,params:p})},ac);
   let x=await own('settings',{set:{tagline:'Hi'}}); check('owner can queue a setting',x.s===200&&x.j.id,x);
   x=await own('settings',{set:{'payhero.api_password':'x'}}); check('owner cannot queue payment keys',x.s===400,x);
   x=await own('settings',{set:{'cloud.url':'x'}}); check('nobody can queue cloud link changes',x.s===400,x);
   x=await own('rm_rf',{}); check('unknown command refused',x.s===400,x);
   x=await own('package_save',{name:'',price:0}); check('bad package refused',x.s===400,x);
   x=await op('settings',{set:{'payhero.api_password':'TOPSECRET','payhero.channel_id':5}}); check('operator can queue payment keys',x.s===200,x);
   x=await op('package_save',{name:'Remote',price:30,duration_minutes:60,evil:'x'}); check('operator can queue a package',x.s===200,x);
   let d=await syncX({}); check('sync delivers the waiting commands with who sent them',d.ok&&d.commands.length===3&&d.commands[0].by==='owner'&&d.commands[1].by==='operator'&&!('evil' in d.commands[2].params),d);
   check('delivered params keep the real secret (signed reply)',d.commands[1].params.set['payhero.api_password']==='TOPSECRET',d.commands[1]);
   d=await syncX({}); check('commands are not sent again straight away',d.commands.length===0,d);
   const ids=(await J('/api/isp/commands',{},ck)).j.items; check('owner list hides secrets',!JSON.stringify(ids).includes('TOPSECRET'),ids);
   await syncX({cmd_results:[{id:d&&ids.find(c=>c.type==='package_save').id,ok:true,msg:'Package saved: Remote'},{id:ids.find(c=>c.by==='operator'&&c.type==='settings').id,ok:false,msg:'nope'}]});
   const after=(await J('/api/admin/isps/'+ID+'/commands',{},ac)).j; const st=Object.fromEntries(after.items.map(c=>[c.type+c.by,c.status+':'+c.result]));
   check('results are recorded',st.package_saveoperator==='ok:Package saved: Remote'&&st.settingsoperator==='failed:nope',st);
   check('secret is masked after the run',!JSON.stringify(after.items).includes('TOPSECRET'),after);
   x=await J('/api/isp/commands',{method:'POST',body:JSON.stringify({type:'sync_now'})}); check('commands need a sign-in',x.s===401,x.s);
   x=await J('/api/admin/isps/'+ID+'/commands',{method:'POST',body:JSON.stringify({type:'sync_now'})},ck); check('an ISP cannot use the operator route',x.s===403,x.s);
   x=await act('profile',{business:'Renamed Net',name:'Owner Name'}); check('operator can edit the ISP profile',x.s===200,x);
   x=await act('profile',{email:'not-an-email'}); check('profile validates',x.s===400,x);
 }
 // sites + price
 r=await act('sites',{value:2}); check('operator sets 2 extra sites',r.s===200,r);
 r=await sync(A); check('license max_sites=2',r.j.license.max_sites===2,r.j.license);
 r=await J('/api/isp/billing',{},ck); check('price = base + 2 sites',r.j.price===1500+2*500&&r.j.sites===2,r.j);
 // grace
 r=await act('extend',{days:-15}); r=await sync(A);
 const L=r.j.license; check('1 day after expiry: still active, in grace',L.active===true&&L.grace===true&&/locks on/.test(L.message)&&!!L.grace_until,L);
 r=await J('/api/me',{},ck); check('state shown as grace',r.j.state==='grace',r.j.state);
 r=await act('extend',{days:-3}); r=await sync(A); check('after grace: inactive, code expired',r.j.license.active===false&&r.j.license.code==='expired'&&r.j.license.grace===false,r.j.license);
 r=await act('suspend'); r=await sync(A); check('suspended code',r.j.license.code==='suspended',r.j.license);
 await act('activate'); await act('extend',{days:20});
 // updates
 r=await sync(A,[],{},'linux-amd64'); const u=r.j.update; check('signed release offered for linux-amd64',u&&u.version==='2.1.0'&&u.sha256.length===64&&u.sig&&u.url===BASE+'/releases/hotspot-billing-2.1.0-linux-amd64',u);
 r=await sync(A,[],{},'linux-arm64'); check('nothing for an architecture without a build',r.j.update===null,r.j.update);
 let f=await fetch(BASE+'/releases/hotspot-billing-2.1.0-linux-amd64'); check('release file downloads',f.status===200&&(await f.text()).trim()==='hello-binary');
 f=await fetch(BASE+'/releases/manifest.json'); check('manifest not downloadable directly',f.status===404);
 f=await fetch(BASE+'/releases/..%2Fserver.js'); check('no path traversal',f.status===404);
 f=await fetch(BASE+'/releases/%2e%2e/.env'); check('no path traversal 2',f.status===404);
 // staged rollout: manifest.rollout limits who is offered the update
 const fsx=require('fs'), mf=require('path').join(__dirname,'data','releases','manifest.json'); const man=JSON.parse(fsx.readFileSync(mf,'utf8'));
 const setRollout=async ro=>{ const m={...man}; if(ro) m.rollout=ro; else delete m.rollout; fsx.writeFileSync(mf,JSON.stringify(m)); };
 await setRollout({pilot:['isp-someone-else'],percent:0,not_before:null});
 r=await sync(A,[],{},'linux-amd64'); check('rollout: not a pilot ISP, no update yet',r.j.update===null,r.j.update);
 await setRollout({pilot:[ID],percent:0,not_before:null});
 r=await sync(A,[],{},'linux-amd64'); check('rollout: pilot ISP gets it',r.j.update&&r.j.update.version==='2.1.0',r.j.update);
 await setRollout({pilot:[],percent:100,not_before:new Date(Date.now()+86400000).toISOString()});
 r=await sync(A,[],{},'linux-amd64'); check('rollout: everyone waits for not_before',r.j.update===null,r.j.update);
 await setRollout({pilot:[],percent:100,not_before:new Date(Date.now()-1000).toISOString()});
 r=await sync(A,[],{},'linux-amd64'); check('rollout: 100% after the date',r.j.update&&r.j.update.version==='2.1.0',r.j.update);
 await setRollout(null);
 // backups: opaque bytes, signed requests only, newest kept
 const signedReq=async(path,method,bodyBuf,id=ID,key=KEY)=>{ const ts=String(Math.floor(Date.now()/1000)), body=bodyBuf||Buffer.alloc(0), sig=crypto.createHmac('sha256',key).update(ts+'.').update(body).digest('hex'); const rr=await fetch(BASE+path,{method,headers:{'Content-Type':'application/octet-stream','X-ISP-Id':id,'X-Timestamp':ts,'X-Signature':sig},...(method==='POST'?{body}:{})}); return {s:rr.status,b:Buffer.from(await rr.arrayBuffer())}; };
 const blob=Buffer.concat([Buffer.from('HB1'),crypto.randomBytes(200)]);
 r=await signedReq('/api/v1/backup','GET'); check('backup: none yet = 404',r.s===404,r.s);
 r=await signedReq('/api/v1/backup','POST',blob); check('backup: upload accepted',r.s===200,r.s);
 r=await signedReq('/api/v1/backup','GET'); check('backup: download returns the same bytes',r.s===200&&r.b.equals(blob),r.s);
 r=await signedReq('/api/v1/backup','POST',Buffer.from('plain text, not a backup, long enough to pass size checks!!')); check('backup: non-backup refused',r.s===400,r.s);
 r=await signedReq('/api/v1/backup','GET',null,ID,'wrong-key-wrong-key-wrong'); check('backup: bad signature refused',r.s===401,r.s);
 r=await signedReq('/api/v1/backup','GET',null,'isp-nobody'); check('backup: unknown ISP refused',r.s===401,r.s);
 for(let k=0;k<9;k++){ await new Promise(x=>setTimeout(x,3)); await signedReq('/api/v1/backup','POST',Buffer.concat([Buffer.from('HB1'),crypto.randomBytes(100+k)])); }
 const bdir=require('path').join(__dirname,'data','backups',ID); check('backup: only 7 kept',fsx.readdirSync(bdir).length===7,fsx.readdirSync(bdir).length);
 // diagnostics
 const dts=String(Math.floor(Date.now()/1000)), dbody=JSON.stringify({note:'slow wifi',report:'== report =='}), dsig=crypto.createHmac('sha256',KEY).update(dts+'.'+dbody).digest('hex');
 let dr=await fetch(BASE+'/api/v1/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-ISP-Id':ID,'X-Timestamp':dts,'X-Signature':dsig},body:dbody}); check('diagnostics: accepted',dr.status===200,dr.status);
 dr=await fetch(BASE+'/api/v1/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-ISP-Id':ID,'X-Timestamp':dts,'X-Signature':'0'.repeat(64)},body:dbody}); check('diagnostics: bad signature refused',dr.status===401,dr.status);
 r=await J('/api/admin/isps/'+ID+'/diagnostics',{},ac); check('operator sees the report',r.j.items&&r.j.items[0]&&r.j.items[0].report==='== report =='&&r.j.items[0].note==='slow wifi',r.j);
 r=await J('/api/admin/isps/'+ID+'/diagnostics',{},ck); check('an ISP cannot read it through the operator route',r.s===403,r.s);
 r=await J('/api/admin/isps',{},ac); const meB=r.j.items.find(i=>i.id===ID); check('operator list shows backup time, hides report',!!meB.backup_at&&!('diagnostics' in meB),Object.keys(meB));
 // reminders: put the ISP 1 day after expiry, restart, the startup sweep stores the stage
 await act('extend',{days:-(20+1)+0}); await new Promise(r=>setTimeout(r,800)); await stop(); await start();
 const adm2=await J('/api/login',{method:'POST',body:JSON.stringify({email:'op@x.com',password:'adminpass123'})});
 r=await J('/api/admin/isps',{},cookieOf(adm2)); const me=r.j.items.find(i=>i.id===ID); check('reminder stage recorded by the sweep',/\|(g0|g1|d1|d3|lock)$/.test(me.reminder_stage||''),me.reminder_stage);
 check('private fields hidden from operator list',!('machine_id' in me)&&me.machine_bound===true&&!me.api_key,Object.keys(me));
 await stop(); console.log(bad?'FAILED '+bad:'ALL PASSED'); process.exit(bad?1:0);
})().catch(e=>{console.error(e); try{srv.kill()}catch{}; process.exit(1)});
