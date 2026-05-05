document.addEventListener('DOMContentLoaded', () => {
    // --- TAB SWITCHING ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-tab');

            // Update nav active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update tab panes
            tabPanes.forEach(pane => {
                if (pane.id === targetId) {
                    pane.classList.add('active');
                } else {
                    pane.classList.remove('active');
                }
            });
        });
    });

    // --- TOAST NOTIFICATION ---
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        if (isError) {
            toast.classList.add('error');
        } else {
            toast.classList.remove('error');
        }
        
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // --- LOAD AI CONFIG ---
    async function loadAIConfig() {
        try {
            const response = await fetch('/api/ai-config');
            const data = await response.json();
            if (data.success && data.config) {
                document.getElementById('business-name').value = data.config.business_name || '';
                document.getElementById('ai-provider').value = data.config.provider || 'groq';
                document.getElementById('api-key').value = data.config.api_key || '';
                
                const modelSelect = document.getElementById('model-name');
                const savedModel = data.config.model_name || data.config.model || 'llama-3.3-70b-versatile';
                // Masukkan model tersimpan sebagai opsi awal
                modelSelect.innerHTML = `<option value="${savedModel}">${savedModel}</option>`;
                modelSelect.value = savedModel;
                
                // Otomatis sinkronisasi model saat load (menggunakan savedModel)
                if (data.config.api_key || data.config.provider === 'openrouter') {
                    // Karena ini di awal, kita beri sedikit delay agar UI stabil
                    setTimeout(() => syncModels(savedModel), 500);
                }
                
                document.getElementById('system-prompt').value = data.config.system_prompt || '';
                
                // Profil Perusahaan
                document.getElementById('company-email').value = data.config.company_email || '';
                document.getElementById('company-address').value = data.config.company_address || '';
                document.getElementById('company-social').value = data.config.company_social || '';
                document.getElementById('company-maps').value = data.config.company_maps || '';
                document.getElementById('business-context').value = data.config.business_context || '';
                document.getElementById('gas-url').value = data.config.gas_url || '';

                // Update brand headline
                if (data.config.business_name) {
                    document.getElementById('brand-name').innerText = data.config.business_name;
                }
            }
        } catch (err) {
            showToast('Gagal memuat konfigurasi AI', true);
        }
    }

    // --- SAVE AI CONFIG ---
    document.getElementById('ai-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
            business_name: document.getElementById('business-name').value,
            provider: document.getElementById('ai-provider').value,
            api_key: document.getElementById('api-key').value,
            model_name: document.getElementById('model-name').value,
            system_prompt: document.getElementById('system-prompt').value,
            company_email: document.getElementById('company-email').value,
            company_address: document.getElementById('company-address').value,
            company_social: document.getElementById('company-social').value,
            company_maps: document.getElementById('company-maps').value,
            business_context: document.getElementById('business-context').value,
            gas_url: document.getElementById('gas-url').value
        };

        const btn = document.getElementById('btn-save-config');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Menyimpan...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/ai-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const data = await response.json();
            if (data.success) {
                showToast('Konfigurasi AI berhasil disimpan!');
                document.getElementById('brand-name').textContent = config.business_name;
            } else {
                showToast(data.error || 'Gagal menyimpan konfigurasi', true);
            }
        } catch (err) {
            showToast('Terjadi kesalahan jaringan', true);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
            lucide.createIcons();
        }
    });

    document.getElementById('profile-form').addEventListener('submit', (e) => {
        e.preventDefault();
        // Memicu submit config-form karena datanya disimpan bersamaan di ai_configs
        document.getElementById('btn-save-config').click();
    });

    // --- GAS LOGIC ---
    document.getElementById('btn-test-gas').addEventListener('click', async () => {
        const gasUrl = document.getElementById('gas-url').value;
        if (!gasUrl) return showToast('Harap isi URL GAS terlebih dahulu', true);
        
        const btn = document.getElementById('btn-test-gas');
        const statusDiv = document.getElementById('gas-status');
        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Testing...';
        btn.disabled = true;
        
        try {
            const response = await fetch('/api/gas/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gas_url: gasUrl })
            });
            const data = await response.json();
            if (data.success) {
                statusDiv.innerHTML = `<span style="color: green;">✅ ${data.message}</span>`;
                showToast('Koneksi GAS Berhasil!');
            } else {
                statusDiv.innerHTML = `<span style="color: red;">❌ ${data.error}</span>`;
                showToast('Koneksi GAS Gagal', true);
            }
        } catch (err) {
            statusDiv.innerHTML = `<span style="color: red;">❌ Terjadi kesalahan jaringan.</span>`;
        } finally {
            btn.innerHTML = '<i data-lucide="plug"></i> Test Connection';
            btn.disabled = false;
            lucide.createIcons();
        }
    });

    document.getElementById('btn-sync-gas').addEventListener('click', async () => {
        const gasUrl = document.getElementById('gas-url').value;
        if (!gasUrl) return showToast('Harap isi URL GAS terlebih dahulu', true);

        // Simpan konfigurasi dulu agar gas_url di database terupdate
        document.getElementById('btn-save-config').click();

        const btn = document.getElementById('btn-sync-gas');
        const statusDiv = document.getElementById('gas-status');
        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Syncing...';
        btn.disabled = true;
        
        try {
            // Tunggu sedikit agar proses save sebelumnya (yang async) bisa selesai
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const response = await fetch('/api/gas/sync-products', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                statusDiv.innerHTML = `<span style="color: green;">✅ Sync berhasil: ${data.synced} produk disinkronkan, ${data.errors} gagal.</span>`;
                showToast(`Sync berhasil! (${data.synced} produk)`);
                loadProducts(); // Muat ulang tabel pricelist
            } else {
                statusDiv.innerHTML = `<span style="color: red;">❌ Gagal: ${data.error}</span>`;
                showToast('Gagal sinkronisasi produk', true);
            }
        } catch (err) {
            statusDiv.innerHTML = `<span style="color: red;">❌ Terjadi kesalahan jaringan atau timeout.</span>`;
        } finally {
            btn.innerHTML = '<i data-lucide="download-cloud"></i> Sync Products Now';
            btn.disabled = false;
            lucide.createIcons();
        }
    });

    // --- SYNC MODELS ---
    async function syncModels(savedModelToSelect = null) {
        const provider = document.getElementById('ai-provider').value;
        const apiKey = document.getElementById('api-key').value;
        const btn = document.getElementById('btn-sync-models');
        const modelSelect = document.getElementById('model-name');
        const helpText = document.getElementById('model-help-text');

        if (!apiKey && provider !== 'openrouter') {
            showToast('API Key diperlukan untuk melihat model.', true);
            return;
        }

        btn.disabled = true;
        const originalBtnText = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader" class="spin" style="width:12px; height:12px;"></i> Loading...';
        helpText.textContent = "Mengambil daftar model...";

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, api_key: apiKey })
            });
            const data = await response.json();
            
            if (data.success) {
                modelSelect.innerHTML = '';
                if (data.models.length === 0) {
                    modelSelect.innerHTML = '<option value="">Tidak ada model ditemukan</option>';
                } else {
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        modelSelect.appendChild(option);
                    });
                    
                    // Jika ada parameter savedModelToSelect, set itu sebagai yang dipilih
                    if (typeof savedModelToSelect === 'string' && data.models.includes(savedModelToSelect)) {
                        modelSelect.value = savedModelToSelect;
                    }
                }
                helpText.textContent = `${data.models.length} model berhasil dimuat.`;
                showToast('Daftar model berhasil disinkronisasi');
            } else {
                showToast(data.error || 'Gagal sinkronisasi model', true);
                helpText.textContent = "Gagal mengambil daftar model.";
            }
        } catch (err) {
            showToast('Terjadi kesalahan jaringan', true);
            helpText.textContent = "Gagal menghubungi server.";
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalBtnText;
            lucide.createIcons();
        }
    }

    document.getElementById('btn-sync-models').addEventListener('click', () => syncModels());

    // Auto-sync ketika provider berubah (bila API Key sudah ada)
    document.getElementById('ai-provider').addEventListener('change', () => {
        const apiKey = document.getElementById('api-key').value;
        if (apiKey || document.getElementById('ai-provider').value === 'openrouter') {
            syncModels();
        }
    });

    // Auto-sync ketika user selesai memasukkan API Key
    document.getElementById('api-key').addEventListener('blur', () => {
        const apiKey = document.getElementById('api-key').value;
        if (apiKey) {
            syncModels();
        }
    });

    // --- LOAD PRODUCTS ---
    async function loadProducts() {
        const tbody = document.getElementById('product-list');
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Memuat data...</td></tr>';
        
        try {
            const response = await fetch('/api/products');
            const data = await response.json();
            
            if (data.success) {
                if (data.products.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Belum ada produk.</td></tr>';
                    return;
                }
                
                tbody.innerHTML = '';
                data.products.forEach(p => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><span class="user-badge">${p.kategori}</span></td>
                        <td><strong>${p.nama_produk}</strong></td>
                        <td>Rp ${p.harga.toLocaleString('id-ID')}</td>
                        <td>${p.keterangan || '-'}</td>
                        <td>
                            <button class="btn btn-secondary btn-sm" onclick="editProduct(${p.id}, '${p.kategori}', '${p.nama_produk}', ${p.harga}, '${p.keterangan || ''}')">
                                <i data-lucide="edit-2" style="width:14px; height:14px;"></i>
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">
                                <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                            </button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
                lucide.createIcons();
            }
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:red;">Gagal memuat daftar harga.</td></tr>';
        }
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
