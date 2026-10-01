const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmt=t=>{const[h,m]=t.split(':').map(Number);return(h%12||12)+':'+String(m).padStart(2,'0')+(h<12?' AM':' PM')};
const weekKey=()=>{const x=new Date();x.setHours(0,0,0,0);x.setDate(x.getDate()+(6-x.getDay()+7)%7);return iso(x)};
let st,me,tab='schedule',cur,notice='';
async function api(m,u,b){const r=await fetch('/api'+u,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
 const d=await r.json().catch(()=>({}));if(r.status===401&&!$('#loginForm')){location.href='login.html';throw new Error('')}if(!r.ok)throw new Error(d.error||'Something went wrong.');return d}
const refresh=async()=>{st=await api('GET','/state');me=st.me};

async function boot(){
 if($('#loginForm'))return $('#loginForm').onsubmit=async e=>{e.preventDefault();
  try{await api('POST','/login',{username:$('#username').value.trim(),password:$('#password').value});location.href='index.html'}catch(x){$('#err').textContent=x.message}};
 await refresh();$('#who').textContent=me.username+' ('+me.role+')';
 $('#logout').onclick=async()=>{await api('POST','/logout');location.href='login.html'};
 document.addEventListener('click',click);const v=$('#view');v.onsubmit=submit;v.onchange=change;render()}

function render(){const admin=me.role==='admin';
 const tabs=me.mustChange?[['account','My account']]:[['schedule','Schedule'],['account','My account'],...(admin?[['members','Members'],['settings','Settings']]:[])];
 if(!tabs.some(t=>t[0]===tab))tab=tabs[0][0];
 $('#nav').innerHTML=tabs.map(t=>`<button data-act="tab" data-v="${t[0]}" class="${t[0]===tab?'on':''}">${t[1]}</button>`).join('');
 $('#view').innerHTML=(notice?`<p class="note">${notice}</p>`:'')+({schedule:vSchedule,account:vAccount,members:vMembers,settings:vSettings}[tab])();notice=''}

function vSchedule(){const admin=me.role==='admin',keys=Object.keys(st.schedules).sort().reverse();
 if(!cur)cur=st.schedules[weekKey()]?weekKey():keys[0]||weekKey();const s=st.schedules[cur],roles=st.settings.roles;
 let h=`<div class="bar"><label>Weekend of Saturday<select id="wk">${[...new Set([cur,...keys])].map(k=>`<option ${k===cur?'selected':''}>${k}</option>`).join('')}</select></label><span class="acts">${s?`<a class="btn" href="/api/schedule/${cur}/docx">Export DOCX</a>`:''}${admin?`<button data-act="gen">${s?'Re-generate':'Generate'} schedule</button>${s?'<button class="warn" data-act="clear">Reset</button>':''}`:''}</span></div>`;
 if(!s)return h+'<section><p>No schedule yet for this weekend.'+(admin?' Select Generate schedule to create one.':' It is created every '+DAYS[st.settings.genDay]+'.')+'</p></section>';
 const users=st.users.map(u=>u.username);
 h+=`<section class="scroll"><table><tr><th>Time</th>${roles.map(r=>`<th>${esc(r)}</th>`).join('')}</tr>`;
 s.slots.forEach((sl,i)=>{const d=new Date(cur+'T00:00');d.setDate(d.getDate()+(sl.day+1)%7);
  h+=`<tr><td>${DAYS[sl.day]} ${d.getMonth()+1}/${d.getDate()}, ${fmt(sl.time)}</td>`+roles.map(r=>{const u=sl.assign[r];
   if(admin)return`<td><select data-act="set" data-i="${i}" data-r="${esc(r)}"><option value="">Unfilled</option>${users.map(x=>`<option ${x===u?'selected':''}>${esc(x)}</option>`).join('')}</select></td>`;
   return u?`<td class="${u===me.username?'me':''}">${esc(u)}</td>`:'<td class="un">Unfilled</td>'}).join('')+'</tr>'});
 const un=s.slots.reduce((n,sl)=>n+roles.filter(r=>!sl.assign[r]).length,0);return h+'</table></section>'+(admin&&un?`<p class="note">${un} assignment(s) unfilled. Members scheduled last week rest this week, so more members need to be available. Fill cells by hand, or turn on repeat weeks in Settings.</p>`:'')+(admin?'<p class="muted">Change any cell to swap members by hand. Members marked Not Available are skipped when generating.</p>':'')}

function vAccount(){const mine=[],s=st.schedules[cur||weekKey()];
 if(s)s.slots.forEach(sl=>Object.entries(sl.assign).forEach(([r,u])=>u===me.username&&mine.push(`${DAYS[sl.day]} ${fmt(sl.time)}: ${esc(r)}`)));
 return`${me.mustChange?'<p class="note">Set a new password to continue.</p>':''}
 ${me.role==='user'?`<section><h2>My availability</h2><p class="muted">Applies to the next schedule that is generated.</p><div class="seg"><button data-act="av" data-v="1" class="${me.available?'on':''}">Available</button><button data-act="av" data-v="0" class="${me.available?'':'on'}">Not available</button></div>
 <h2 style="margin-top:20px">My assignments this weekend</h2>${mine.length?'<ul>'+mine.map(m=>`<li>${m}</li>`).join('')+'</ul>':'<p class="muted">No assignments yet.</p>'}</section>`:''}
 <section><h2>Change password</h2><form id="pwForm"><label for="np">New password (at least 6 characters)</label><input id="np" type="password" minlength="6" autocomplete="new-password" required><br><br><button>Save password</button></form></section>`}

function vMembers(){return`<section><h2>Add member</h2><form id="addForm" class="row"><div><label for="nu">Username</label><input id="nu" required></div><div><label for="nr">Role</label><select id="nr"><option value="user">User</option><option value="admin">Admin</option></select></div><button>Add member</button></form><p class="muted">A temporary password is created. The member must change it at first login.</p></section>
 <section class="scroll"><h2>Members</h2><table><tr><th>Username</th><th>Role</th><th>Status</th><th></th></tr>${st.users.map(u=>`<tr><td>${esc(u.username)}</td><td>${u.role}</td><td>${u.role==='user'?`<span class="badge ${u.available?'':'off'}">${u.available?'Available':'Not available'}</span>`:''}</td><td><button class="ghost" data-act="reset" data-u="${esc(u.username)}">Reset password</button> ${u.username===me.username?'':`<button class="warn" data-act="del" data-u="${esc(u.username)}">Remove</button>`}</td></tr>`).join('')}</table></section>`}

function vSettings(){const S=st.settings;return`<section><h2>Scheduling settings</h2><form id="setForm">
 <label for="gd">Create the schedule automatically on</label><select id="gd">${DAYS.map((d,i)=>`<option value="${i}" ${i==S.genDay?'selected':''}>${d}</option>`).join('')}</select>
 <label for="rl">Roles (one per line)</label><textarea id="rl" rows="4">${esc(S.roles.join('\n'))}</textarea>
 <label class="chk"><input id="ar" type="checkbox" ${S.allowRepeat?'checked':''}> Allow repeat weeks when there are not enough members</label>
 <label>Time slots</label>${S.slots.map((s,i)=>`<div class="row slot" style="margin-bottom:6px"><select class="d">${DAYS.map((d,j)=>`<option value="${j}" ${j==s.day?'selected':''}>${d}</option>`).join('')}</select><input class="t" type="time" value="${s.time}" required><button type="button" class="warn" data-act="delslot" data-i="${i}">Remove</button></div>`).join('')}
 <p><button type="button" class="ghost" data-act="addslot" style="color:var(--acc)">Add time slot</button></p><button>Save settings</button></form></section>`}

function readSettings(){const S=st.settings;S.genDay=+$('#gd').value;S.allowRepeat=$('#ar').checked;S.roles=$('#rl').value.split('\n').map(x=>x.trim()).filter(Boolean);
 S.slots=[...document.querySelectorAll('.slot')].map(r=>({day:+r.querySelector('.d').value,time:r.querySelector('.t').value||'00:00'}))}
const tmp=p=>`Temporary password for <b>${esc(p[0])}</b>: <code>${p[1]}</code>. Share it privately.`;

async function click(e){const b=e.target.closest('button[data-act]');if(!b)return;const a=b.dataset.act,D=b.dataset;
 try{
  if(a==='tab')tab=D.v;
  else if(a==='gen'){const k=cur||weekKey();if(st.schedules[k]&&!confirm('Replace the current schedule for '+k+'?'))return;const r=await api('POST','/schedule/generate',{key:k});cur=k;await refresh();if(r.unfilled)notice=r.unfilled+' assignment(s) could not be filled. Not enough members are free after the one-week rest rule.'}
  else if(a==='clear'){if(!confirm('Reset the schedule for '+cur+'? All assignments will be cleared.'))return;await api('DELETE','/schedule/'+cur);await refresh();notice='Schedule cleared. Select Generate schedule to create a new one.'}
  else if(a==='av'){await api('POST','/availability',{available:D.v==='1'});await refresh()}
  else if(a==='reset'){const r=await api('POST','/users/'+encodeURIComponent(D.u)+'/reset');notice=tmp([D.u,r.password]);await refresh()}
  else if(a==='del'){if(!confirm('Remove '+D.u+'?'))return;await api('DELETE','/users/'+encodeURIComponent(D.u));await refresh()}
  else if(a==='addslot'){readSettings();st.settings.slots.push({day:0,time:'08:00'})}
  else if(a==='delslot'){readSettings();st.settings.slots.splice(+D.i,1)}
 }catch(err){notice=esc(err.message)}
 render()}

async function submit(e){e.preventDefault();const f=e.target.id;
 try{
  if(f==='pwForm'){await api('POST','/password',{password:$('#np').value});await refresh();notice='Password updated.';tab='schedule'}
  else if(f==='addForm'){const n=$('#nu').value.trim(),r=await api('POST','/users',{username:n,role:$('#nr').value});await refresh();notice=`Added. ${tmp([n,r.password])}`}
  else if(f==='setForm'){readSettings();await api('PUT','/settings',st.settings);await refresh();notice='Settings saved. Select Re-generate on the Schedule tab to apply them to an existing week.'}
 }catch(err){notice=esc(err.message)}
 render()}

async function change(e){const t=e.target;
 if(t.id==='wk'){cur=t.value;render()}
 else if(t.dataset.act==='set'){try{await api('PUT',`/schedule/${cur}/cell`,{i:+t.dataset.i,role:t.dataset.r,user:t.value||null});await refresh()}catch(err){notice=esc(err.message);render()}}}
boot();
