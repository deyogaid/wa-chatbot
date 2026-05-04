'use strict';

// ── HELPERS ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = n => Number(n||0).toLocaleString('id-ID');

let _toastT;
function toast(msg, type='ok'){
  const el=$('toast'); el.textContent=msg;
  el.className='toast show '+type;
  clearTimeout(_toastT);
  _toastT=setTimeout(()=>el.className='toast',2800);
}

async function api(url, opts={}, ms=6000){
  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),ms);
  try{
    const r=await fetch(url,{signal:ctrl.signal,...opts});
    clearTimeout(tid);
    return await r.json();
  }catch(e){
    clearTimeout(tid);
    return{success:false,error:e.name==='AbortError'?'Timeout':e.message};
  }
}

function show(id){ $(id).style.display='block' }
function hide(id){ $(id).style.display='none' }
function showFlex(id){ $(id).style.display='flex' }

// ── NAVIGATION ──────────────────────────────────────────
function nav(tab){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panel=$('tab-'+tab);
  if(panel) panel.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));

  window.scrollTo(0,0);

  if(tab==='dashboard') loadDashboard();
  if(tab==='config')    loadConfig();
  if(tab==='products')  loadProducts();
  if(tab==='faqs')      loadFaqs();
  if(tab==='profile')   loadProfile();
}

// ── DASHBOARD ────────────────────────────────────────────
let _prevBotStatus = '';
async function loadDashboard(){
  await Promise.all([loadBotStatus(), loadAlerts(), loadCounts()]);
}

async function loadBotStatus(){
  const d=await api('/api/bot-status',{},3000);
  if(d.success){
    if(d.status !== _prevBotStatus){
      _prevBotStatus = d.status;
      if(d.status === 'connected'){
        toast('✅ Bot terhubung ke WhatsApp!', 'ok');
      }
    }
    renderBot(d);
  }
}

function renderBot(d){
  const st=d.status||'disconnected';
  hide('wa-conn'); hide('wa-cing'); hide('wa-disc');
  if(st==='connected')    show('wa-conn');
  else if(st==='connecting') show('wa-cing');
  else                    show('wa-disc');

  const badge=$('wa-badge');
  const sEl=$('s-status'), since=$('s-since'), phone=$('wa-phone');

  if(st==='connected'){
    badge.className='badge badge-green';
    badge.innerHTML='<span class="dot pulse"></span>Connected';
    sEl.textContent='✅'; sEl.style.color='var(--green)';
    phone.textContent=d.phone?'+'+d.phone:'Terhubung';
    since.textContent=d.since?'Sejak '+new Date(d.since).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'Aktif';
    document.querySelector('#wa-conn .alert-box').style.display='flex';
  }else if(st==='connecting'){
    badge.className='badge badge-yellow';
    badge.innerHTML='<span class="dot pulse"></span>Connecting';
    sEl.textContent='⏳'; sEl.style.color='var(--yellow)';
    phone.textContent='Menghubungkan...'; since.textContent='Sedang proses...';
  }else{
    badge.className='badge badge-red';
    badge.innerHTML='<span class="dot"></span>Disconnected';
    sEl.textContent='✗'; sEl.style.color='var(--red)';
    phone.textContent='Belum terhubung'; since.textContent='Bot tidak aktif';
  }
}

async function loadCounts(){
  const [pr,fq]=await Promise.all([api('/api/products',{},3000),api('/api/faqs',{},3000)]);
  $('s-products').textContent=pr.products?.length??'—';
  $('s-faqs').textContent=fq.faqs?.length??'—';
}

function parseAlert(raw){
  const o={provider:null,model:null,waktu:null,status:null,tindakan:null,error:null};
  (raw||'').split('\n').forEach(l=>{
    const i=l.indexOf(':'); if(i<0) return;
    const k=l.slice(0,i).trim().toLowerCase();
    const v=l.slice(i+1).trim();
    if(k==='provider') o.provider=v;
    else if(k==='model')    o.model=v;
    else if(k==='waktu')    o.waktu=v;
    else if(k==='status')   o.status=v;
    else if(k==='tindakan') o.tindakan=v;
    else if(k==='error')    o.error=v;
  });
  return o;
}

function renderAlertCard(a){
  const isNew=a.is_read===0;
  const p=parseAlert(a.message||'');
  const isStructured=!!(p.provider||p.status||p.tindakan);
  const ts=a.timestamp?new Date(a.timestamp).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';

  if(isStructured){
    const st=p.status||'';
    const isErr=st.includes('401')||st.includes('402')||st.includes('403');
    const isWarn=st.includes('429')||st.includes('503')||st.includes('500');
    const borderC=isErr?'var(--red)':isWarn?'var(--yellow)':'var(--muted)';
    const bgC=isErr?'rgba(248,81,73,.06)':isWarn?'rgba(210,153,34,.06)':'rgba(88,166,255,.06)';

    return `<div style="border-left:3px solid ${borderC};background:${bgC};margin:10px 12px;border-radius:0 8px 8px 0;padding:12px 14px;${isNew?'':'opacity:.65'}">
      <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div class="flex items-center gap-8" style="flex-wrap:wrap">
          ${p.provider?`<span style="background:var(--bg3);border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--text)">${esc(p.provider)}</span>`:''}
          ${p.model?`<span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--blue);background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:2px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block">${esc(p.model)}</span>`:''}
          ${isNew?'<span style="background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:100px">BARU</span>':''}
        </div>
        <span class="text-xs text-muted">${ts}</span>
      </div>
      ${p.status?`<div style="font-size:13px;font-weight:600;color:${borderC};margin-bottom:6px">${esc(p.status)}</div>`:''}
      ${p.error?`<div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;margin-bottom:8px;word-break:break-all">${esc(p.error)}</div>`:''}
      ${p.tindakan?`<div style="font-size:12px;color:var(--green);display:flex;gap:6px;align-items:flex-start"><span style="flex-shrink:0">→</span><span>${esc(p.tindakan)}</span></div>`:''}
    </div>`;
  }

  return `<div class="flex items-start gap-8" style="padding:12px 16px;border-bottom:1px solid var(--bg3);${isNew?'':'opacity:.65'}">
    <div style="width:7px;height:7px;border-radius:50%;background:var(--muted);margin-top:5px;flex-shrink:0"></div>
    <div class="flex-1">
      <div style="font-size:13px;${isNew?'font-weight:600':'color:var(--muted)'};white-space:pre-wrap">${esc(a.message||'—')}</div>
      <div class="text-xs text-muted mt-4">${ts}</div>
    </div>
  </div>`;
}

async function loadAlerts(){
  const d=await api('/api/alerts',{},3000);
  const body=$('alerts-body');
  $('s-alerts').textContent=d.unreadCount??0;
  if((d.unreadCount??0)>0) show('read-btn'); else hide('read-btn');

  if(!d.alerts?.length){
    body.innerHTML='<div class="dempty">Tidak ada notifikasi</div>'; return;
  }
  body.innerHTML=d.alerts.map(a=>renderAlertCard(a)).join('');
}

async function markRead(){
  await api('/api/alerts/read',{method:'POST'});
  hide('read-btn'); $('s-alerts').textContent='0'; loadAlerts();
}

async function getPairingCode(){
  const phone=$('phone-inp').value.trim();
  if(!phone){toast('Masukkan nomor WhatsApp','err');return;}
  hide('pair-txt'); show('pair-ld'); $('pair-btn').disabled=true;
  const d=await api('/api/bot-connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})},15000);
  show('pair-txt'); hide('pair-ld'); $('pair-btn').disabled=false;
  if(d.success&&d.pairing_code){
    show('pair-result'); $('pair-code').textContent=d.pairing_code; toast('Kode berhasil dibuat!');
  }else toast(d.error||'Gagal mendapat kode','err');
}

// ── AI CONFIG ────────────────────────────────────────────
async function loadConfig(){
  const d=await api('/api/ai-config'); const c=d.config||{};
  $('c-prov').value   = c.provider        ||'gemini';
  $('c-key').value    = c.api_key         ||'';
  $('c-name').value   = c.business_name   ||'';
  $('c-email').value  = c.company_email   ||'';
  $('c-addr').value   = c.company_address ||'';
  $('c-social').value = c.company_social  ||'';
  $('c-maps').value   = c.company_maps    ||'';
  $('c-ctx').value    = c.business_context||'';
  $('c-prompt').value = c.system_prompt   ||'';
  if(c.model){
    const sel=$('c-model');
    if(![...sel.options].some(o=>o.value===c.model))
      sel.innerHTML+=`<option value="${esc(c.model)}">${esc(c.model)}</option>`;
    sel.value=c.model;
  }
}

function onProviderChange(){
  $('c-model').innerHTML='<option value="">— pilih model —</option>';
}

async function fetchModels(){
  const prov=$('c-prov').value, key=$('c-key').value.trim();
  hide('fetch-txt'); show('fetch-ld'); $('fetch-btn').disabled=true;
  const d=await api('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:prov,api_key:key})},12000);
  show('fetch-txt'); hide('fetch-ld'); $('fetch-btn').disabled=false;
  if(d.success&&d.models?.length){
    $('c-model').innerHTML=d.models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
    toast(`${d.models.length} model ditemukan`, 'info');
  }else toast(d.error||'Gagal mengambil model','err');
}

async function saveConfig(){
  const payload={
    provider:$('c-prov').value, api_key:$('c-key').value,
    model:$('c-model').value,
    business_name:$('c-name').value, company_email:$('c-email').value,
    company_address:$('c-addr').value, company_social:$('c-social').value,
    company_maps:$('c-maps').value, business_context:$('c-ctx').value,
    system_prompt:$('c-prompt').value,
  };
  const d=await api('/api/ai-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(d.success){
    toast('Konfigurasi tersimpan!', 'ok');
  } else {
    toast(d.error||'Gagal menyimpan konfigurasi','err');
  }
}

// ── PRODUCTS ─────────────────────────────────────────────
let _prods=[];

async function loadProducts(){
  $('products-tbl').innerHTML='<div class="dempty">Memuat...</div>';
  const d=await api('/api/products'); _prods=d.products||[]; renderProds();
}

function renderProds(){
  if(!_prods.length){$('products-tbl').innerHTML='<div class="dempty">Belum ada produk. Ketuk "+ Tambah" untuk mulai.</div>';return;}
  $('products-tbl').innerHTML=_prods.map(p=>{
    const id=p._id||p.id;
    return`<div class="drow">
      <div class="flex-1" style="min-width:0">
        <div class="fw6 truncate" style="font-size:14px">${esc(p.nama_produk||p.name||'—')}</div>
        <div class="text-xs text-muted mt-4">${esc(p.kategori||p.category||'Umum')}${p.keterangan||p.notes?' · '+esc(p.keterangan||p.notes):''}</div>
      </div>
      <div style="color:var(--green);font-weight:600;font-size:13px;white-space:nowrap;padding:0 8px">Rp${fmt(p.harga||p.price)}</div>
      <div class="flex gap-6">
        <button class="btn btn-ghost btn-sm" onclick="editProd('${id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="delProd('${id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openModal(type){
  if(type==='p'){
    $('mp-id').value=$('mp-name').value=$('mp-price').value=$('mp-cat').value=$('mp-notes').value='';
    $('mp-title').textContent='Tambah Produk';
    $('modal-p').classList.add('open');
  }else{
    $('mf-id').value=$('mf-cmd').value=$('mf-resp').value='';
    $('mf-title').textContent='Tambah FAQ';
    $('modal-f').classList.add('open');
  }
}

function editProd(id){
  const p=_prods.find(x=>(x._id||x.id)===id); if(!p)return;
  $('mp-id').value=id; $('mp-name').value=p.nama_produk||p.name||'';
  $('mp-price').value=p.harga||p.price||''; $('mp-cat').value=p.kategori||p.category||'';
  $('mp-notes').value=p.keterangan||p.notes||'';
  $('mp-title').textContent='Edit Produk'; $('modal-p').classList.add('open');
}

async function saveProduct(){
  const id=$('mp-id').value, name=$('mp-name').value.trim(), price=$('mp-price').value;
  if(!name||!price){toast('Nama dan harga wajib diisi','err');return;}
  const d=await api(id?`/api/products/${id}`:'/api/products',{
    method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nama_produk:name,harga:price,kategori:$('mp-cat').value.trim()||'Umum',keterangan:$('mp-notes').value.trim()})
  });
  if(d.success){toast(id?'Produk diperbarui!':'Produk ditambahkan!');closeModal('modal-p');loadProducts();}
  else toast(d.error||'Gagal','err');
}

async function delProd(id){
  if(!confirm('Hapus produk ini?'))return;
  const d=await api(`/api/products/${id}`,{method:'DELETE'});
  d.success?(toast('Produk dihapus'),loadProducts()):toast(d.error,'err');
}

// ── FAQs ─────────────────────────────────────────────────
let _faqs=[];

async function loadFaqs(){
  $('faqs-tbl').innerHTML='<div class="dempty">Memuat...</div>';
  const d=await api('/api/faqs'); _faqs=d.faqs||[]; renderFaqs();
}

function renderFaqs(){
  if(!_faqs.length){$('faqs-tbl').innerHTML='<div class="dempty">Belum ada FAQ. Ketuk "+ Tambah" untuk mulai.</div>';return;}
  $('faqs-tbl').innerHTML=_faqs.map(f=>{
    const id=f._id||f.id;
    return`<div class="drow items-start">
      <div class="flex-1" style="min-width:0">
        <span style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-family:'DM Mono',monospace;font-size:12px;color:var(--blue);display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.command||'—')}</span>
        <div class="text-xs text-muted mt-4 truncate">${esc(f.response||'—')}</div>
      </div>
      <div class="flex gap-6" style="margin-left:8px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="editFaq('${id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="delFaq('${id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function editFaq(id){
  const f=_faqs.find(x=>(x._id||x.id)===id); if(!f)return;
  $('mf-id').value=id; $('mf-cmd').value=f.command||''; $('mf-resp').value=f.response||'';
  $('mf-title').textContent='Edit FAQ'; $('modal-f').classList.add('open');
}

async function saveFaq(){
  const id=$('mf-id').value, cmd=$('mf-cmd').value.trim(), resp=$('mf-resp').value.trim();
  if(!cmd||!resp){toast('Command dan balasan wajib diisi','err');return;}
  const d=await api(id?`/api/faqs/${id}`:'/api/faqs',{
    method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({command:cmd,response:resp})
  });
  if(d.success){toast(id?'FAQ diperbarui!':'FAQ ditambahkan!');closeModal('modal-f');loadFaqs();}
  else toast(d.error||'Gagal','err');
}

async function delFaq(id){
  if(!confirm('Hapus FAQ ini?'))return;
  const d=await api(`/api/faqs/${id}`,{method:'DELETE'});
  d.success?(toast('FAQ dihapus'),loadFaqs()):toast(d.error,'err');
}

// ── MODALS ───────────────────────────────────────────────
function closeModal(id){$(id).classList.remove('open')}
function oclose(e,id){if(e.target===$(id))closeModal(id)}

// ── PROFILE ─────────────────────────────────────────────
let _profileData = null;

async function loadProfile() {
  const d = await api('/api/bot-profile');
  if (!d.success) return;
  _profileData = d.profile;
  $('pp-name').textContent = d.profile.name || '—';
  $('pp-phone').textContent = d.profile.phone || '—';
  if (d.profile.pictureUrl) {
    $('pp-img').src = d.profile.pictureUrl;
    $('pp-img').style.display = 'block';
  } else {
    $('pp-img').style.display = 'none';
  }
  const bizBadge = $('pp-biz-badge');
  const bizInfo = $('pp-business-info');
  if (d.profile.isBusiness && d.profile.business) {
    bizBadge.style.display = 'inline-flex';
    const b = d.profile.business;
    let info = '';
    if (b.description) info += `<div class="text-sm mt-4">📝 ${esc(b.description)}</div>`;
    if (b.address) info += `<div class="text-sm mt-4">📍 ${esc(b.address)}</div>`;
    if (b.email) info += `<div class="text-sm mt-4">📧 ${esc(b.email)}</div>`;
    if (b.website) info += `<div class="text-sm mt-4">🌐 ${esc(b.website)}</div>`;
    bizInfo.innerHTML = info;
    bizInfo.style.display = 'block';
  } else {
    bizBadge.style.display = 'none';
    bizInfo.style.display = 'none';
  }
}

async function updateProfile() {
  const fileInput = $('pp-file');
  const file = fileInput.files[0];
  let base64Img = '';
  
  if (file) {
    if (file.size > 2 * 1024 * 1024) {
      toast('Foto maksimal 2MB', 'err');
      return;
    }
    base64Img = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });
  }

  const status = $('pp-status').value.trim();
  const payload = {};
  if (base64Img) payload.profilePicture = base64Img;
  if (status) payload.status = status;

  if (!base64Img && !status) {
    toast('Isi foto atau status terlebih dahulu', 'err');
    return;
  }

  const d = await api('/api/bot-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (d.success) {
    toast('Profil berhasil diperbarui', 'ok');
    fileInput.value = '';
    $('pp-status').value = '';
    loadProfile();
  } else {
    toast(d.error || 'Gagal memperbarui profil', 'err');
  }
}

// ── SYNC CATALOG ─────────────────────────────────────────
async function syncToWACatalog() {
  if (!confirm('Ini akan menghapus SEMUA produk di katalog WhatsApp dan menggantinya dengan produk dari Dashboard. Lanjutkan?')) return;

  const syncBtn = document.querySelector('#sync-btns .btn');
  const origText = syncBtn.innerHTML;
  syncBtn.innerHTML = '<span class="spinner"></span> Menyinkronkan...';
  syncBtn.disabled = true;

  const d = await api('/api/products/sync-catalog', { method: 'POST' });
  syncBtn.innerHTML = origText;
  syncBtn.disabled = false;

  if (d.success) {
    toast(d.message || 'Katalog WhatsApp disinkronkan!', 'ok');
    $('sync-last').textContent = 'Terakhir: ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    loadProducts();
  } else {
    toast(d.error || 'Gagal sinkronisasi', 'err');
  }
}

function checkBizStatus() {
  api('/api/bot-status').then(d => {
    if (d.isBusiness) {
      $('sync-btns').style.display = 'flex';
    } else {
      $('sync-btns').style.display = 'none';
    }
  });
}

// Override loadProducts untuk memanggil checkBiz
const origLoadProducts = loadProducts;
loadProducts = async function() {
  await origLoadProducts();
  checkBizStatus();
};

const origLoadDashboard = loadDashboard;
loadDashboard = async function() {
  await origLoadDashboard();
  checkBizStatus();
};

// ── AUTO REFRESH ─────────────────────────────────────────
setInterval(()=>{
  if($('tab-dashboard').classList.contains('active')) loadBotStatus();
},10000);

// ── INIT ─────────────────────────────────────────────────
nav('dashboard');