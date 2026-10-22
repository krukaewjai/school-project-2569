/* โรงเรียนบ้านคอกม้า | รายงานโครงการปีการศึกษา 2569 | Supabase JS v3
   No build step; all user-entered HTML is escaped; access is checked by database RLS. */
(() => {
  'use strict';
  const TYPES = [
    ['เงินรายได้สถานศึกษา','🏫','#d9f2e8'],
    ['เงินบริจาค','💗','#fce1e9'],
    ['เงินค่าจัดการเรียนการสอน','📚','#dbeafc'],
    ['เงินค่าหนังสือเรียน','📖','#fff0cd'],
    ['เงินค่าอุปกรณ์การเรียน','✏️','#f9e4d4'],
    ['เงินค่าเครื่องแบบนักเรียน','👕','#dee9ff'],
    ['เงินค่ากิจกรรมพัฒนาผู้เรียน','🎨','#eee3ff'],
    ['เงินโครงการอาหารกลางวัน','🍲','#e3f3d2']
  ];
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const PAGE_SIZE = 10;
  const BUCKET = 'project-pdfs-2569';
  const cfg = window.APP_CONFIG || {};
  const el = document.getElementById('app');
  const modal = document.getElementById('modal-host');
  const toastEl = document.getElementById('toast');
  const pr = document.getElementById('print-root');
  let client = null;
  let currentUser = null;
  let member = null;
  let busy = false;
  let toastTimer = null;
  const state = {
    tab:'dashboard', selectedProjectId:null,
    projectSearch:'', expenseSearch:'', fundFilter:'', expenseProjectFilter:'',
    projectPage:1, expensePage:1, activityPage:1, detailExpensePage:1
  };
  const rows = { projects:[], activities:[], expenses:[], files:[] };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function attr(value){ return escapeHtml(value); }
  function money(n) { return new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0); }
  function num(n) {return new Intl.NumberFormat('th-TH').format(n||0);}
  function short(value,n=100) { const s=String(value??''); return s.length>n?s.slice(0,n-1)+'…':s; }
  function dateToday(){let d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function thaiDate(v) { if(!v) return '-'; const [y,m,d]=String(v).slice(0,10).split('-').map(Number); if(!y||!m||!d)return '-';return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y+543}`; }
  function sum(items) {return items.reduce((x,o)=>x+Number(o.amount||0),0);}
  function findProject(id) {return rows.projects.find(p=>p.id===id);}
  function findActivity(id){return rows.activities.find(a=>a.id===id);}
  function spent(id){return sum(rows.expenses.filter(x=>x.project_id===id));}
  function getProjectFiles(id,activityId=null){return rows.files.filter(f=>f.project_id===id && f.activity_id===activityId);}
  function pages(items,page){const count=Math.max(1,Math.ceil(items.length/PAGE_SIZE));const n=Math.min(count,Math.max(1,page));return {n,count,items:items.slice((n-1)*PAGE_SIZE,n*PAGE_SIZE)};}
  function showToast(message,isError=false){clearTimeout(toastTimer);toastEl.textContent=String(message);toastEl.className='toast visible'+(isError?' error':'');toastTimer=setTimeout(()=>toastEl.className='toast',5400);}
  function errorMessage(e){let text=String(e?.message||e||'เกิดข้อผิดพลาด');if(/Failed to fetch|NetworkError|fetch failed/i.test(text))return 'เชื่อมต่ออินเทอร์เน็ตหรือ Supabase ไม่ได้ โปรดลองใหม่';if(/JWT|refresh token/i.test(text))return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';if(/row-level security|permission denied/i.test(text))return 'ไม่มีสิทธิ์ดำเนินการ กรุณาตรวจสอบ SQL/RLS และบัญชีเจ้าหน้าที่';if(/duplicate key/i.test(text))return 'พบข้อมูลซ้ำในระบบ';return text;}
  function showError(e){console.error(e);showToast(errorMessage(e),true);}
  function setBusy(v){busy=v;document.querySelectorAll('.btn,button[type=submit]').forEach(x=>{if(!x.dataset.originalDisabled){x.dataset.originalDisabled=x.disabled?'1':'0'}x.disabled=v || x.dataset.originalDisabled==='1';});}
  async function run(operation){if(busy)return;setBusy(true);try{await operation();}catch(e){showError(e);}finally{setBusy(false);}}
  function check(result){if(result.error)throw result.error;return result.data;}
  function assertChanged(changed){if(!changed?.length)throw new Error('ไม่พบข้อมูลที่ต้องการแก้ไข/ลบ หรือสิทธิ์เข้าถึงถูกยกเลิก โปรดโหลดหน้าใหม่');}
  async function fetchTable(table,sortField='created_at',ascending=false){
    const chunk=700;let all=[];
    for(let from=0;from<100000;from+=chunk){
      const data=check(await client.from(table).select('*').order(sortField,{ascending}).order('id',{ascending:true}).range(from,from+chunk-1));
      all.push(...data);if(data.length<chunk)return all;
    }
    throw new Error('ข้อมูลมีจำนวนมากเกินขีดจำกัดการดึงข้อมูล กรุณาติดต่อผู้ดูแลระบบ');
  }
  async function loadData(){
    const [p,a,e,f]=await Promise.all([
      fetchTable('school_projects','created_at'),fetchTable('project_activities','created_at'),
      fetchTable('project_expenses','expense_date'),fetchTable('project_files','created_at')
    ]);
    rows.projects=p;rows.activities=a;rows.expenses=e;rows.files=f;
    if(state.selectedProjectId&&!findProject(state.selectedProjectId)){state.tab='projects';state.selectedProjectId=null;}
    render();
  }
  async function ensureAllowed(){
    const data=check(await client.from('staff_members').select('user_id,full_name,is_active').eq('user_id',currentUser.id).maybeSingle());
    if(!data||!data.is_active){await client.auth.signOut();currentUser=null;member=null;showToast('บัญชีนี้ยังไม่มีสิทธิ์แก้ไขข้อมูล สามารถเข้าชมได้ตามปกติ',true);return false;}
    member=data;return true;
  }
  function validConfig(){return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.SUPABASE_URL||'') && /^(sb_publishable_|eyJ)/.test(cfg.SUPABASE_PUBLISHABLE_KEY||'');}
  async function start(){
    if(!window.supabase?.createClient){showSetup('โหลด Supabase JS ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตหรือ CDN');return;}
    if(!validConfig()){showSetup('โปรดเปิดไฟล์ config.js และใส่ SUPABASE_URL กับ Publishable key จาก Supabase');return;}
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    try{
      const {data,error}=await client.auth.getSession();if(error)throw error;
      if(data.session){
        currentUser=data.session.user;
        await ensureAllowed();
      }
      await loadData();
    }catch(e){showSetup('ไม่สามารถโหลดข้อมูลได้: '+errorMessage(e)+' กรุณาตรวจสอบ SQL สิทธิ์ public read และการเชื่อมต่อ Supabase');}
  }
  function showSetup(message){el.innerHTML=`<div class="login-wrap"><div class="glass login-card"><div class="horse">⚙️</div><h1>ตั้งค่าระบบก่อนใช้งาน</h1><p>${escapeHtml(message)}</p><p class="login-tip">รายละเอียดอยู่ในไฟล์ README.md ภายในชุดดาวน์โหลด</p></div></div>`;}
  function showLogin(message=''){
    el.innerHTML=`<div class="login-wrap"><section class="glass login-card"><div class="horse">🐴🏫</div><h1>ระบบรายงานโครงการ</h1><h2>ประจำปีการศึกษา ${escapeHtml(cfg.ACADEMIC_YEAR||'2569')}</h2><p>${escapeHtml(cfg.SCHOOL_NAME||'โรงเรียน')}</p><form id="login-form"><div class="field"><label for="login-email">อีเมลเจ้าหน้าที่</label><input id="login-email" type="email" name="email" autocomplete="username" required></div><div class="field" style="margin-top:13px"><label for="login-password">รหัสผ่าน</label><input id="login-password" type="password" name="password" autocomplete="current-password" required minlength="6"></div><div class="form-actions"><button class="btn primary" type="submit" style="width:100%">🔐 เข้าสู่ระบบ</button></div></form>${message?`<p class="login-tip" style="color:#ad3538">${escapeHtml(message)}</p>`:''}<p class="login-tip">สำหรับบัญชีเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้น</p><button type="button" class="btn ghost" data-action="view-as-guest">👀 กลับไปดูรายงานโดยไม่เข้ารหัส</button></section></div>`;
  }
  function base(){
    return `<div class="layout"><header class="glass topbar"><div class="brand"><div class="logo">🏫🐴</div><div><h1>ระบบรายงานโครงการ</h1><small>${escapeHtml(cfg.SCHOOL_NAME||'โรงเรียน')} • ประจำปีการศึกษา ${escapeHtml(cfg.ACADEMIC_YEAR||'2569')}</small></div></div><div class="top-actions">${member?`<span class="muted">👤 ${escapeHtml(member.full_name||currentUser?.email||'ครูผู้บันทึก')}</span><button type="button" class="btn ghost sm" data-action="logout">🚪 ออกจากระบบ</button>`:`<span class="viewer-tag">👀 โหมดเข้าชม</span><button type="button" class="btn primary sm" data-action="login">🔐 ครูเข้าสู่ระบบ</button>`}</div></header><nav class="nav"><button class="nav-btn ${state.tab==='dashboard'?'active':''}" data-action="nav-dashboard">📊 แดชบอร์ด</button><button class="nav-btn ${state.tab==='projects'?'active':''}" data-action="nav-projects">📁 รายงานโครงการ</button>${state.tab==='detail'?'<button class="nav-btn active" data-action="noop">📋 รายละเอียดโครงการ</button>':''}</nav><main id="main-content"></main><footer class="footer">📚 ระบบรายงานโครงการ • เปิดดูข้อมูลได้โดยไม่ต้องเข้าสู่ระบบ • การแก้ไขต้องได้รับสิทธิ์เจ้าหน้าที่</footer></div>`;
  }
  function render(){
    el.innerHTML=base();
    let content=state.tab==='dashboard'?renderDashboard():state.tab==='projects'?renderProjects():renderDetail();
    document.getElementById('main-content').innerHTML=content;
  }
  function projectSelect(value='',allowAll=true){return `${allowAll?'<option value="">ทุกโครงการ</option>':''}${rows.projects.map(p=>`<option value="${attr(p.id)}" ${p.id===value?'selected':''}>${escapeHtml(p.project_name)}</option>`).join('')}`;}
  function fundSelect(value='',all=true){
    const first=all?'<option value="">ทุกประเภทเงิน</option>':`<option value="" disabled ${!value?'selected':''}>— กรุณาเลือกประเภทเงิน —</option>`;
    return `${first}${TYPES.map(([name])=>`<option value="${attr(name)}" ${value===name?'selected':''}>${escapeHtml(name)}</option>`).join('')}`;
  }
  function expenseFilterRows(){const q=state.expenseSearch.trim().toLowerCase();return rows.expenses.filter(e=>(!state.fundFilter||e.funding_type===state.fundFilter)&&(!state.expenseProjectFilter||e.project_id===state.expenseProjectFilter)&&(!q||[e.detail,e.funding_type,findProject(e.project_id)?.project_name,findActivity(e.activity_id)?.activity_name].some(t=>String(t||'').toLowerCase().includes(q))));}
  function expenseTable(items,forProject=false){
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>ลำดับ</th><th>วันที่ใช้จ่าย</th>${forProject?'':'<th>โครงการ</th>'}<th>กิจกรรมย่อย</th><th>ประเภทเงิน</th><th>รายละเอียด</th><th class="text-right">จำนวนเงิน (บาท)</th>${member?'<th>จัดการ</th>':''}</tr></thead><tbody>${items.length?items.map((e,i)=>`<tr><td>${i+1}</td><td>${thaiDate(e.expense_date)}</td>${forProject?'':`<td class="clip-col">${escapeHtml(findProject(e.project_id)?.project_name||'ไม่พบโครงการ')}</td>`}<td class="clip-col">${escapeHtml(findActivity(e.activity_id)?.activity_name||'—')}</td><td>${escapeHtml(e.funding_type)}</td><td class="clip-col">${escapeHtml(e.detail||'—')}</td><td class="money">${money(e.amount)}</td>${member?`<td class="action-cell"><button class="btn blue sm" data-action="edit-expense" data-id="${attr(e.id)}">✏️ แก้ไข</button><button class="btn red sm" data-action="delete-expense" data-id="${attr(e.id)}">🗑️ ลบ</button></td>`:''}</tr>`).join(''):`<tr><td colspan="${forProject?(member?'7':'6'):(member?'8':'7')}" class="empty">ยังไม่มีรายการใช้จ่าย</td></tr>`}</tbody></table></div>`;
  }
  function pagination(key,p){return `<div class="pagination"><span>แสดง ${p.items.length?((p.n-1)*PAGE_SIZE+1):0}–${Math.min(p.n*PAGE_SIZE,p.total||0)} จาก ${num(p.total||0)} รายการ</span><button class="btn ghost sm" data-action="page" data-key="${key}" data-page="${p.n-1}" ${p.n<=1?'disabled':''}>◀ ก่อนหน้า</button><span>หน้า ${p.n}/${p.count}</span><button class="btn ghost sm" data-action="page" data-key="${key}" data-page="${p.n+1}" ${p.n>=p.count?'disabled':''}>ถัดไป ▶</button></div>`;}
  function pageItems(items,key){const p=pages(items,state[key]);state[key]=p.n;p.total=items.length;return p;}
  function renderDashboard(){
    const totals=Object.fromEntries(TYPES.map(([n])=>[n,sum(rows.expenses.filter(e=>e.funding_type===n))]));
    const cards=TYPES.map(([title,ico,color])=>`<div class="stat-card" style="--tint:${color}"><div class="stat-title">${ico} ${escapeHtml(title)}</div><div class="stat-money">฿${money(totals[title])}</div><div class="stat-count">${num(rows.expenses.filter(e=>e.funding_type===title).length)} รายการ</div></div>`).join('');
    const filtered=expenseFilterRows();const p=pageItems(filtered,'expensePage');
    return `<section class="glass panel"><div class="panel-head"><div><h2>📊 สรุปการใช้จ่ายตามประเภทเงิน</h2><p>ยอดรวมรายจ่ายที่บันทึก • ปีการศึกษา ${escapeHtml(cfg.ACADEMIC_YEAR||'2569')}</p></div><div class="buttons"><button class="btn yellow" data-action="print-dashboard">🖨️ พิมพ์หน้านี้ A4</button>${member?'<button class="btn primary" data-action="new-expense">➕ บันทึกรายจ่าย</button>':''}</div></div><div class="stats">${cards}</div><div class="summary-strip"><span>💵 ใช้จ่ายรวม <strong>฿${money(sum(rows.expenses))}</strong></span><span>📁 โครงการทั้งหมด <strong>${num(rows.projects.length)}</strong></span><span>🧩 กิจกรรมย่อย <strong>${num(rows.activities.length)}</strong></span><span>📎 ไฟล์ PDF <strong>${num(rows.files.length)}</strong></span></div></section><section class="glass panel"><div class="panel-head"><h2>📋 ตารางรายการใช้จ่าย</h2><span class="muted">แสดงหน้าละ 10 รายการ</span></div><form id="expense-filter-form" class="filters"><input class="grow" name="q" value="${attr(state.expenseSearch)}" placeholder="🔎 ค้นหารายละเอียด / โครงการ"><select class="select-filter" name="fund">${fundSelect(state.fundFilter)}</select><select class="select-filter" name="project">${projectSelect(state.expenseProjectFilter)}</select><button type="submit" class="btn blue">ค้นหา</button><button type="button" data-action="clear-expense-filters" class="btn ghost">ล้างตัวกรอง</button></form>${expenseTable(p.items)}${pagination('expensePage',p)}</section>`;
  }
  function renderProjects(){const q=state.projectSearch.trim().toLowerCase();const filtered=rows.projects.filter(p=>!q||[p.project_name,p.coordinator,p.description,p.funding_type].some(x=>String(x||'').toLowerCase().includes(q)));const pg=pageItems(filtered,'projectPage');return `<section class="glass panel"><div class="panel-head"><div><h2>📁 หน้ารายงานโครงการ</h2><p>เพิ่มโครงการ กิจกรรมย่อย รายจ่าย และไฟล์ PDF ได้หลายไฟล์ต่อโครงการ</p></div>${member?'<button class="btn primary" data-action="new-project">➕ เพิ่มโครงการ</button>':''}</div><form id="project-filter-form" class="filters"><input class="grow" name="q" value="${attr(state.projectSearch)}" placeholder="🔎 ค้นหาชื่อโครงการ / ผู้รับผิดชอบ"><button class="btn blue" type="submit">ค้นหา</button><button class="btn ghost" type="button" data-action="clear-project-filters">ล้าง</button></form><div class="table-wrap"><table class="data-table"><thead><tr><th>ลำดับ</th><th>ชื่อโครงการ</th><th>ผู้รับผิดชอบ</th><th class="text-right">งบที่ตั้งไว้</th><th class="text-right">ใช้จ่ายจริง</th><th>กิจกรรม / PDF</th><th>${member?'จัดการ':'ดูรายละเอียด'}</th></tr></thead><tbody>${pg.items.length?pg.items.map((p,i)=>`<tr><td>${(pg.n-1)*PAGE_SIZE+i+1}</td><td class="clip-col"><strong>${escapeHtml(p.project_name)}</strong><div class="small-label fund-label">💰 ${escapeHtml(p.funding_type||'ยังไม่ระบุประเภทเงิน • กรุณาแก้ไขโครงการ')}</div><div class="small-label muted">${escapeHtml(short(p.description,95))}</div></td><td>${escapeHtml(p.coordinator||'—')}</td><td class="money">${money(p.budget_plan)}</td><td class="money">${money(spent(p.id))}</td><td>${rows.activities.filter(a=>a.project_id===p.id).length} กิจกรรม / ${rows.files.filter(f=>f.project_id===p.id).length} ไฟล์</td><td class="action-cell"><button class="btn primary sm" data-action="open-project" data-id="${attr(p.id)}">📂 เปิด</button>${member?`<button class="btn blue sm" data-action="upload-file" data-project="${attr(p.id)}">📎 PDF</button><button class="btn yellow sm" data-action="new-expense" data-project="${attr(p.id)}">💵 จ่าย</button><button class="btn blue sm" data-action="edit-project" data-id="${attr(p.id)}">✏️</button><button class="btn red sm" data-action="delete-project" data-id="${attr(p.id)}">🗑️</button>`:''}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">ยังไม่มีโครงการ กดปุ่ม “เพิ่มโครงการ”</td></tr>`}</tbody></table></div>${pagination('projectPage',pg)}</section>`;}
  function renderFiles(items){if(!items.length)return `<p class="muted">— ยังไม่มีไฟล์ PDF —</p>`;return `<div class="files">${items.map(f=>`<div class="file-chip"><span>📄</span><strong>${escapeHtml(short(f.original_name,65))}</strong><span class="muted">(${Math.ceil(f.file_size/1024)} KB)</span><button class="btn blue sm" data-action="open-file" data-id="${attr(f.id)}">เปิด</button>${member?`<button class="btn red sm" data-action="delete-file" data-id="${attr(f.id)}">✕</button>`:''}</div>`).join('')}</div>`;}
  function renderDetail(){
    const p=findProject(state.selectedProjectId);if(!p){state.tab='projects';return renderProjects();}
    const acts=rows.activities.filter(a=>a.project_id===p.id);
    const af=pageItems(acts,'activityPage');const ex=rows.expenses.filter(e=>e.project_id===p.id);
    const ep=pageItems(ex,'detailExpensePage');const amt=spent(p.id);const remaining=Number(p.budget_plan)-amt;
    return `<section class="glass panel"><div class="backline"><button class="btn ghost sm" data-action="nav-projects">◀ กลับรายการโครงการ</button></div><div class="detail-head"><div><h2>📂 ${escapeHtml(p.project_name)}</h2><p class="muted">ผู้รับผิดชอบ: ${escapeHtml(p.coordinator||'ไม่ระบุ')}</p><p class="project-fund-info">💰 <strong>ประเภทเงินที่ได้รับจัดสรร:</strong> ${escapeHtml(p.funding_type||'ยังไม่ระบุ • กรุณาแก้ไขโครงการ')}</p><p>${escapeHtml(p.description||'')}</p></div><div class="buttons"><button class="btn yellow" data-action="print-project">🖨️ พิมพ์รายงาน A4</button>${member?`<button class="btn blue" data-action="edit-project" data-id="${attr(p.id)}">✏️ แก้ไขโครงการ</button>`:''}</div></div><div class="mini-stats"><span class="pill">💰 งบที่ตั้งไว้ ฿${money(p.budget_plan)}</span><span class="pill">🧾 ใช้จ่ายจริง ฿${money(amt)}</span><span class="pill">${remaining>=0?'✅ คงเหลือ':'⚠️ เกินงบ'} ฿${money(Math.abs(remaining))}</span><span class="pill">📄 ${rows.files.filter(f=>f.project_id===p.id).length} ไฟล์</span></div></section>
    <section class="glass panel"><div class="panel-head"><h2>📎 ไฟล์ PDF หลักของโครงการ</h2>${member?`<button class="btn blue" data-action="upload-file" data-project="${attr(p.id)}">⬆️ อัปโหลด PDF</button>`:'<button class="btn ghost sm" data-action="login">🔐 เข้าสู่ระบบเพื่ออัปโหลด PDF</button>'}</div>${renderFiles(getProjectFiles(p.id))}</section>
    <section class="glass panel"><div class="panel-head"><div><h2>🧩 กิจกรรมย่อยในโครงการ</h2><p>แต่ละกิจกรรมแนบ PDF ได้หลายไฟล์และบันทึกค่าใช้จ่ายแยกกันได้</p></div>${member?`<button class="btn primary" data-action="new-activity" data-project="${attr(p.id)}">➕ เพิ่มกิจกรรมย่อย</button>`:''}</div>${af.items.length?af.items.map(a=>`<div class="activity-card"><div class="activity-head"><div><h3>🎯 ${escapeHtml(a.activity_name)}</h3><p class="muted">${escapeHtml(a.note||'')} • ใช้จ่าย ฿${money(sum(ex.filter(x=>x.activity_id===a.id)))}</p></div>${member?`<div class="activity-actions"><button class="btn ghost sm" data-action="new-expense" data-project="${attr(p.id)}" data-activity="${attr(a.id)}">💵 บันทึกรายจ่าย</button><button class="btn blue sm" data-action="upload-file" data-project="${attr(p.id)}" data-activity="${attr(a.id)}">📎 เพิ่ม PDF</button><button class="btn yellow sm" data-action="edit-activity" data-id="${attr(a.id)}">✏️ แก้ไข</button><button class="btn red sm" data-action="delete-activity" data-id="${attr(a.id)}">🗑️ ลบ</button></div>`:''}</div>${renderFiles(getProjectFiles(p.id,a.id))}</div>`).join(''):`<p class="empty">ยังไม่มีกิจกรรมย่อย</p>`}${pagination('activityPage',af)}</section>
    <section class="glass panel"><div class="panel-head"><div><h2>🧾 บันทึกรายการใช้จ่ายของโครงการ</h2><p>หน้าละ 10 รายการ • เพิ่มได้ทั้งในระดับโครงการและกิจกรรมย่อย</p></div>${member?`<button class="btn primary" data-action="new-expense" data-project="${attr(p.id)}">➕ เพิ่มรายจ่าย</button>`:''}</div>${expenseTable(ep.items,true)}${pagination('detailExpensePage',ep)}</section>`;
  }
  function openModal(title,body){modal.hidden=false;modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${escapeHtml(title)}</h2><button type="button" class="close" data-action="close-modal" aria-label="ปิด">×</button></header>${body}</div>`;modal.querySelector('input:not([type=hidden]),select,textarea')?.focus();}
  function closeModal(){modal.hidden=true;modal.innerHTML='';}
  function field(label,name,value='',extra='',full=false){return `<div class="field ${full?'full':''}"><label>${label}</label><input name="${attr(name)}" value="${attr(value)}" ${extra}></div>`;}
  function formButtons(){return `<div class="form-actions"><button type="button" class="btn ghost" data-action="close-modal">ยกเลิก</button><button type="submit" class="btn primary">💾 บันทึกข้อมูล</button></div>`;}
  function projectForm(id){
    const p=findProject(id)||{};
    openModal(id?'✏️ แก้ไขโครงการ':'➕ เพิ่มโครงการ',`<form data-form="project">
      <input type="hidden" name="id" value="${attr(p.id||'')}">
      <div class="form-grid">
        ${field('ชื่อโครงการ *','project_name',p.project_name||'','required maxlength="250"',true)}
        <div class="field full">
          <label for="project-funding-type">💰 ประเภทเงินที่ได้รับจัดสรร *</label>
          <select name="funding_type" id="project-funding-type" required>${fundSelect(p.funding_type||'',false)}</select>
          <small class="field-tip">เลือกแหล่งเงินหลักที่จัดสรรให้โครงการนี้ จาก 8 ประเภท</small>
        </div>
        ${field('ผู้รับผิดชอบ','coordinator',p.coordinator||'','maxlength="180"')}
        ${field('งบประมาณที่ตั้งไว้ (บาท)','budget_plan',p.budget_plan??0,'type="number" min="0" step="0.01" required')}
        <div class="field full"><label>รายละเอียด / วัตถุประสงค์</label><textarea name="description" maxlength="2000">${escapeHtml(p.description||'')}</textarea></div>
      </div>${formButtons()}</form>`);
  }
  function activityForm(id,projectId){const a=findActivity(id)||{};openModal(id?'✏️ แก้ไขกิจกรรมย่อย':'➕ เพิ่มกิจกรรมย่อย',`<form data-form="activity"><input type="hidden" name="id" value="${attr(a.id||'')}"><input type="hidden" name="project_id" value="${attr(a.project_id||projectId)}"><div class="form-grid">${field('ชื่อกิจกรรมย่อย *','activity_name',a.activity_name||'','required maxlength="250"',true)}<div class="field full"><label>รายละเอียดกิจกรรม</label><textarea name="note" maxlength="1500">${escapeHtml(a.note||'')}</textarea></div></div>${formButtons()}</form>`);}
  function activityOptions(projectId,selected=''){return `<option value="">ค่าใช้จ่ายของโครงการหลัก (ไม่ระบุกิจกรรม)</option>${rows.activities.filter(a=>a.project_id===projectId).map(a=>`<option value="${attr(a.id)}" ${selected===a.id?'selected':''}>${escapeHtml(a.activity_name)}</option>`).join('')}`;}
  function expenseForm(id,projectId='',activityId=''){
    const ex=rows.expenses.find(x=>x.id===id)||{};
    if(!rows.projects.length){showToast('กรุณาเพิ่มโครงการก่อนบันทึกรายจ่าย',true);return;}
    const selectedProject=ex.project_id||projectId||rows.projects[0].id;
    // Default to the selected project's allocated source. Existing expenses retain their historical source.
    const selectedFunding=ex.funding_type||findProject(selectedProject)?.funding_type||'';
    openModal(id?'✏️ แก้ไขรายการใช้จ่าย':'💵 เพิ่มรายการใช้จ่าย',`<form data-form="expense"><input type="hidden" name="id" value="${attr(ex.id||'')}"><div class="form-grid"><div class="field full"><label>โครงการ *</label><select name="project_id" id="expense-project" required>${projectSelect(selectedProject,false)}</select></div><div class="field full"><label>กิจกรรมย่อย (ถ้ามี)</label><select name="activity_id" id="expense-activity">${activityOptions(selectedProject,ex.activity_id||activityId)}</select></div><div class="field full"><label>ประเภทเงินที่ใช้จ่าย *</label><select name="funding_type" id="expense-funding-type" required>${fundSelect(selectedFunding,false)}</select><small class="field-tip">ระบบเลือกประเภทเงินที่โครงการได้รับจัดสรรให้อัตโนมัติ สามารถเปลี่ยนได้หากใช้เงินจากแหล่งอื่น</small></div>${field('วันที่ใช้จ่าย *','expense_date',ex.expense_date||dateToday(),'type="date" required')}${field('จำนวนเงินที่ใช้จ่าย (บาท) *','amount',ex.amount??'','type="number" min="0.01" step="0.01" required')}<div class="field full"><label>รายละเอียดรายการ / รายการจ่าย</label><textarea name="detail" maxlength="1500">${escapeHtml(ex.detail||'')}</textarea></div></div>${formButtons()}</form>`);
  }
  function uploadForm(projectId,activityId=''){
    const p=findProject(projectId);const a=findActivity(activityId);
    if(!p)return;
    openModal('📎 อัปโหลดเอกสาร PDF',`<p class="hint">โครงการ: <strong>${escapeHtml(p.project_name)}</strong>${a?` • กิจกรรม: <strong>${escapeHtml(a.activity_name)}</strong>`:''}</p><form data-form="files"><input type="hidden" name="project_id" value="${attr(projectId)}"><input type="hidden" name="activity_id" value="${attr(activityId)}"><div class="field"><label>เลือกไฟล์ PDF (เลือกพร้อมกันได้หลายไฟล์)</label><input type="file" name="files" accept=".pdf,application/pdf" multiple required></div><p class="file-help">รองรับ PDF เท่านั้น • ไม่เกิน 15 MB ต่อไฟล์ • ไม่จำกัดจำนวนไฟล์ต่อโครงการตามพื้นที่จัดเก็บที่มี</p>${formButtons()}</form>`);
  }
  function confirmAction(title,msg,action,id){openModal(title,`<p>${escapeHtml(msg)}</p><div class="form-actions"><button class="btn ghost" data-action="close-modal">ยกเลิก</button><button class="btn red" data-action="${attr(action)}" data-id="${attr(id)}">🗑️ ยืนยันการลบ</button></div>`);}
  async function saveProject(fd){
    const id=fd.get('id');
    const payload={
      project_name:String(fd.get('project_name')||'').trim(),
      funding_type:String(fd.get('funding_type')||'').trim(),
      coordinator:String(fd.get('coordinator')||'').trim(),
      description:String(fd.get('description')||'').trim(),
      budget_plan:Number(fd.get('budget_plan'))
    };
    if(!payload.project_name||!Number.isFinite(payload.budget_plan)||payload.budget_plan<0){
      throw Error('กรุณาระบุข้อมูลโครงการให้ถูกต้อง');
    }
    if(!TYPES.some(([name])=>name===payload.funding_type)){
      throw Error('กรุณาเลือกประเภทเงินที่ได้รับจัดสรรจากรายการ');
    }
    if(id){assertChanged(check(await client.from('school_projects').update(payload).eq('id',id).select('id')));}
    else{assertChanged(check(await client.from('school_projects').insert(payload).select('id')));}
    closeModal();await loadData();showToast('บันทึกโครงการและประเภทเงินที่ได้รับจัดสรรแล้ว');
  }
  async function saveActivity(fd){const id=fd.get('id'),payload={project_id:fd.get('project_id'),activity_name:String(fd.get('activity_name')||'').trim(),note:String(fd.get('note')||'').trim()};if(!payload.activity_name)throw Error('กรุณากรอกชื่อกิจกรรมย่อย');if(id){delete payload.project_id;assertChanged(check(await client.from('project_activities').update(payload).eq('id',id).select('id')));}else{assertChanged(check(await client.from('project_activities').insert(payload).select('id')));}closeModal();await loadData();showToast('บันทึกกิจกรรมย่อยเรียบร้อย');}
  async function saveExpense(fd){
    const id=fd.get('id'),amount=Number(fd.get('amount'));
    const payload={project_id:fd.get('project_id'),activity_id:fd.get('activity_id')||null,funding_type:fd.get('funding_type'),expense_date:fd.get('expense_date'),detail:String(fd.get('detail')||'').trim(),amount};
    if(!findProject(payload.project_id))throw Error('ไม่พบโครงการ');
    if(!Number.isFinite(amount)||amount<=0||!TYPES.some(x=>x[0]===payload.funding_type))throw Error('จำนวนเงินต้องมากกว่า 0 และประเภทเงินถูกต้อง');
    if(payload.activity_id&&findActivity(payload.activity_id)?.project_id!==payload.project_id)throw Error('กิจกรรมย่อยไม่ตรงกับโครงการ');
    if(id){assertChanged(check(await client.from('project_expenses').update(payload).eq('id',id).select('id')));}else{assertChanged(check(await client.from('project_expenses').insert(payload).select('id')));}
    closeModal();await loadData();showToast('บันทึกค่าใช้จ่ายเรียบร้อย');
  }
  async function saveFiles(fd,form){
    const projectId=String(fd.get('project_id')),activityId=String(fd.get('activity_id')||'')||null;
    if(!findProject(projectId))throw Error('ไม่พบโครงการ');
    const files=Array.from(form.querySelector('input[type=file]').files||[]);if(!files.length)throw Error('กรุณาเลือกไฟล์ PDF');
    for(const file of files){
      if(file.size<=0||file.size>MAX_FILE_SIZE)throw Error(`${file.name}: ขนาดไฟล์ต้องไม่เกิน 15 MB`);
      if(!/\.pdf$/i.test(file.name))throw Error(`${file.name}: ต้องเป็นไฟล์ PDF`);
      const header=new Uint8Array(await file.slice(0,5).arrayBuffer());
      if(String.fromCharCode(...header)!=='%PDF-')throw Error(`${file.name}: เนื้อหาไฟล์ไม่ใช่ PDF ที่ถูกต้อง`);
    }
    let success=0;const failures=[];
    for(const file of files){
      const path=`${projectId}/${crypto.randomUUID()}.pdf`;
      const uploaded=await client.storage.from(BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
      if(uploaded.error){failures.push(`${file.name}: ${uploaded.error.message}`);continue;}
      const inserted=await client.from('project_files').insert({project_id:projectId,activity_id:activityId,original_name:file.name,storage_path:path,file_size:file.size}).select('id');
      if(inserted.error){await client.storage.from(BUCKET).remove([path]);failures.push(`${file.name}: ${inserted.error.message}`);continue;}
      success++;
    }
    closeModal();await loadData();
    if(failures.length)showToast(`สำเร็จ ${success} ไฟล์ • ไม่สำเร็จ ${failures.length} ไฟล์: ${short(failures.join('; '),180)}`,true);
    else showToast(`อัปโหลด PDF สำเร็จ ${success} ไฟล์`);
  }
  async function deleteExpense(id){assertChanged(check(await client.from('project_expenses').delete().eq('id',id).select('id')));closeModal();await loadData();showToast('ลบรายการใช้จ่ายแล้ว');}
  async function deleteActivity(id){assertChanged(check(await client.from('project_activities').delete().eq('id',id).select('id')));closeModal();await loadData();showToast('ลบกิจกรรมแล้ว • รายจ่ายและ PDF คงอยู่ในโครงการหลัก');}
  async function deleteFile(id){
    const f=rows.files.find(x=>x.id===id);if(!f)return;
    check(await client.storage.from(BUCKET).remove([f.storage_path]));
    assertChanged(check(await client.from('project_files').delete().eq('id',id).select('id')));
    closeModal();await loadData();showToast('ลบไฟล์ PDF เรียบร้อย');
  }
  async function deleteProject(id){
    const f=rows.files.filter(x=>x.project_id===id);
    for(let i=0;i<f.length;i+=50){check(await client.storage.from(BUCKET).remove(f.slice(i,i+50).map(x=>x.storage_path)));}
    assertChanged(check(await client.from('school_projects').delete().eq('id',id).select('id')));
    closeModal();await loadData();showToast('ลบโครงการพร้อมกิจกรรม รายจ่าย และ PDF แล้ว');
  }
  async function openFile(id){
    const f=rows.files.find(x=>x.id===id);if(!f)return;
    // Open new tab synchronously before awaiting a network response to avoid popup blockers.
    const tab=window.open('about:blank','_blank');
    try{
      const d=check(await client.storage.from(BUCKET).createSignedUrl(f.storage_path,120));
      if(tab){tab.location.replace(d.signedUrl);}else{window.location.href=d.signedUrl;}
    }catch(e){if(tab)tab.close();throw e;}
  }
  function buildPrint(title,meta,pills,dataRows,columns,footer=''){
    const headers=columns.map(c=>`<th style="width:${c.w||'auto'}">${escapeHtml(c.label)}</th>`).join('');
    const tableRows=dataRows.length?dataRows.map((r,i)=>`<tr>${columns.map((c,j)=>`<td style="${c.right?'text-align:right;':''}">${escapeHtml(c.render(r,i))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${columns.length}" style="text-align:center">ไม่มีรายการบันทึกในหน้านี้</td></tr>`;
    const pillsHtml=pills.map(p=>`<div>${escapeHtml(p[0])}<strong>${escapeHtml(p[1])}</strong></div>`).join('');
    pr.innerHTML=`<div class="print-paper"><h1>${escapeHtml(cfg.SCHOOL_NAME||'โรงเรียน')}</h1><h2>${escapeHtml(title)} • ประจำปีการศึกษา ${escapeHtml(cfg.ACADEMIC_YEAR||'2569')}</h2><div class="print-meta">${escapeHtml(meta)} • พิมพ์วันที่ ${thaiDate(dateToday())}</div><div class="print-pills">${pillsHtml}</div><table class="print-table"><thead><tr>${headers}</tr></thead><tbody>${tableRows}</tbody></table><div class="print-foot"><span>${escapeHtml(footer)}</span><span>รายการที่ปรากฏบนหน้าจอนี้: ${dataRows.length} รายการ</span></div><div class="print-sign">ลงชื่อ ........................................................ ผู้จัดทำรายงาน</div></div>`;
  }
  async function printSheet(){if(document.fonts?.ready)await document.fonts.ready;window.print();}
  function expenseColumns(withProject){let cols=[{label:'ที่',w:'5%',render:(r,i)=>String(i+1)},{label:'วันที่',w:'11%',render:r=>thaiDate(r.expense_date)}];if(withProject)cols.push({label:'โครงการ',w:'17%',render:r=>short(findProject(r.project_id)?.project_name||'-',36)});cols.push({label:'กิจกรรมย่อย',w:withProject?'15%':'20%',render:r=>short(findActivity(r.activity_id)?.activity_name||'-',35)},{label:'ประเภทเงิน',w:withProject?'20%':'24%',render:r=>short(r.funding_type,55)},{label:'รายละเอียด',w:withProject?'20%':'25%',render:r=>short(r.detail||'-',75)},{label:'จำนวน (บาท)',w:'12%',right:true,render:r=>money(r.amount)});return cols;}
  async function printDashboard(){const list=expenseFilterRows();const p=pageItems(list,'expensePage');const pills=TYPES.map(([name])=>[name,`${money(sum(rows.expenses.filter(x=>x.funding_type===name)))} บาท`]);buildPrint('สรุปการใช้จ่ายแยกตามประเภทเงิน',`รวมทุกรายการ ฿${money(sum(rows.expenses))} • ตารางหน้า ${p.n}/${p.count}`,pills,p.items,expenseColumns(true),'หมายเหตุ: ยอดรวมด้านบนคิดจากข้อมูลทั้งหมด โดยตารางด้านล่างพิมพ์เฉพาะหน้าปัจจุบัน');await printSheet();}
  async function printProject(){const p=findProject(state.selectedProjectId);if(!p)return;const ex=rows.expenses.filter(e=>e.project_id===p.id);const current=pageItems(ex,'detailExpensePage');const pills=[['ประเภทเงินที่ได้รับจัดสรร',p.funding_type||'ยังไม่ระบุ'],['งบที่ตั้งไว้',money(p.budget_plan)+' บาท'],['ใช้จ่ายจริง',money(sum(ex))+' บาท'],['กิจกรรมย่อย',`${rows.activities.filter(a=>a.project_id===p.id).length} กิจกรรม`]];buildPrint(`รายงานการใช้จ่ายโครงการ: ${p.project_name}`,`ผู้รับผิดชอบ ${p.coordinator||'-'} • PDF ${rows.files.filter(f=>f.project_id===p.id).length} ไฟล์ • ตารางหน้า ${current.n}/${current.count}`,pills,current.items,expenseColumns(false),`รายละเอียด: ${short(p.description||'-',115)}`);await printSheet();}
  async function onClick(event){
    const btn=event.target.closest('[data-action]');if(!btn)return;event.preventDefault();
    const action=btn.dataset.action,id=btn.dataset.id,projectId=btn.dataset.project||state.selectedProjectId,activityId=btn.dataset.activity||'';
    if(busy)return;
    const writeActions=['new-project','edit-project','delete-project','confirm-delete-project','new-activity','edit-activity','delete-activity','confirm-delete-activity','new-expense','edit-expense','delete-expense','confirm-delete-expense','upload-file','delete-file','confirm-delete-file'];
    if(writeActions.includes(action) && !member){showToast('เฉพาะครูที่เข้าสู่ระบบและได้รับสิทธิ์เท่านั้นที่แก้ไขข้อมูลได้',true);return;}
    switch(action){
      case 'noop':break;
      case 'login':showLogin();break;
      case 'view-as-guest':await run(loadData);break;
      case 'nav-dashboard':state.tab='dashboard';render();break;
      case 'nav-projects':state.tab='projects';render();break;
      case 'open-project':state.selectedProjectId=id;state.tab='detail';state.activityPage=1;state.detailExpensePage=1;render();break;
      case 'new-project':projectForm();break;
      case 'edit-project':projectForm(id);break;
      case 'new-activity':activityForm(null,projectId);break;
      case 'edit-activity':activityForm(id);break;
      case 'new-expense':expenseForm(null,projectId,activityId);break;
      case 'edit-expense':expenseForm(id);break;
      case 'upload-file':uploadForm(projectId,activityId);break;
      case 'open-file':await run(()=>openFile(id));break;
      case 'delete-project':confirmAction('⚠️ ยืนยันลบโครงการ',`ลบ “${findProject(id)?.project_name||''}” พร้อมกิจกรรม รายจ่าย และไฟล์ PDF ทั้งหมดถาวรหรือไม่?`,'confirm-delete-project',id);break;
      case 'delete-activity':confirmAction('⚠️ ยืนยันลบกิจกรรม','ลบกิจกรรมนี้หรือไม่? เพื่อป้องกันข้อมูลสูญหาย รายจ่ายและ PDF ของกิจกรรมจะย้ายไปอยู่ระดับโครงการหลัก','confirm-delete-activity',id);break;
      case 'delete-expense':confirmAction('⚠️ ยืนยันลบรายการ','ต้องการลบรายการใช้จ่ายนี้หรือไม่?','confirm-delete-expense',id);break;
      case 'delete-file':confirmAction('⚠️ ยืนยันลบ PDF',`ต้องการลบไฟล์ “${rows.files.find(f=>f.id===id)?.original_name||''}” อย่างถาวรหรือไม่?`,'confirm-delete-file',id);break;
      case 'confirm-delete-project':await run(()=>deleteProject(id));break;
      case 'confirm-delete-activity':await run(()=>deleteActivity(id));break;
      case 'confirm-delete-expense':await run(()=>deleteExpense(id));break;
      case 'confirm-delete-file':await run(()=>deleteFile(id));break;
      case 'page':if(!Number.isFinite(Number(btn.dataset.page)))return;state[btn.dataset.key]=Math.max(1,Number(btn.dataset.page));render();break;
      case 'clear-project-filters':state.projectSearch='';state.projectPage=1;render();break;
      case 'clear-expense-filters':state.expenseSearch='';state.fundFilter='';state.expenseProjectFilter='';state.expensePage=1;render();break;
      case 'close-modal':closeModal();break;
      case 'print-dashboard':await run(printDashboard);break;
      case 'print-project':await run(printProject);break;
      case 'logout':await run(async()=>{check(await client.auth.signOut());currentUser=null;member=null;await loadData();showToast('ออกจากระบบแล้ว • ยังคงเปิดดูรายงานได้');});break;
      default:break;
    }
  }
  async function onSubmit(ev){
    const f=ev.target;if(!(f instanceof HTMLFormElement))return;ev.preventDefault();if(busy)return;
    if(f.id==='login-form'){
      await run(async()=>{
        const fd=new FormData(f);const {data,error}=await client.auth.signInWithPassword({email:String(fd.get('email')).trim(),password:String(fd.get('password'))});
        if(error)throw error;currentUser=data.user;
        if(await ensureAllowed()){await loadData();showToast('เข้าสู่ระบบสำหรับบันทึกข้อมูลสำเร็จ');}
        else await loadData();
      });return;
    }
    if(f.id==='project-filter-form'){state.projectSearch=String(new FormData(f).get('q')||'');state.projectPage=1;render();return;}
    if(f.id==='expense-filter-form'){const d=new FormData(f);state.expenseSearch=String(d.get('q')||'');state.fundFilter=String(d.get('fund')||'');state.expenseProjectFilter=String(d.get('project')||'');state.expensePage=1;render();return;}
    const type=f.dataset.form;if(!type)return;
    if(!member){showToast('ไม่มีสิทธิ์บันทึก กรุณาเข้าสู่ระบบของครู',true);return;}
    await run(async()=>{const fd=new FormData(f);if(type==='project')await saveProject(fd);if(type==='activity')await saveActivity(fd);if(type==='expense')await saveExpense(fd);if(type==='files')await saveFiles(fd,f);});
  }
  el.addEventListener('click',onClick);modal.addEventListener('click',onClick);
  el.addEventListener('submit',onSubmit);modal.addEventListener('submit',onSubmit);
  modal.addEventListener('change',ev=>{
    if(ev.target?.id==='expense-project'){
      const v=ev.target.value;
      const activitySelect=modal.querySelector('#expense-activity');
      if(activitySelect)activitySelect.innerHTML=activityOptions(v);
      const fundingSelect=modal.querySelector('#expense-funding-type');
      if(fundingSelect){
        const allocated=findProject(v)?.funding_type||'';
        fundingSelect.value=TYPES.some(([name])=>name===allocated)?allocated:'';
      }
    }
  });
  modal.addEventListener('click',ev=>{if(ev.target===modal)closeModal();});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!modal.hidden&&!busy)closeModal();});
  start();
})();
