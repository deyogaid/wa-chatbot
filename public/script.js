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
                const savedModel = data.config.model_name || 'llama-3.3-70b-versatile';
                // Masukkan model tersimpan sebagai opsi awal
                modelSelect.innerHTML = `<option value="${savedModel}">${savedModel}</option>`;
                modelSelect.value = savedModel;
                
                document.getElementById('system-prompt').value = data.config.system_prompt || '';
                
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
            system_prompt: document.getElementById('system-prompt').value
        };

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = 'Menyimpan...';

        try {
            const response = await fetch('/api/ai-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const data = await response.json();
            
            if (data.success) {
                showToast('Konfigurasi AI berhasil disimpan!');
                // Synchronize headline
                document.getElementById('brand-name').innerText = config.business_name || 'KartiniBot';
            } else {
                showToast(data.error || 'Gagal menyimpan', true);
            }
        } catch (err) {
            showToast('Terjadi kesalahan jaringan', true);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="save"></i> Simpan Konfigurasi';
            lucide.createIcons();
        }
    });

    // --- SYNC MODELS ---
    async function syncModels() {
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

    document.getElementById('btn-sync-models').addEventListener('click', syncModels);

    // Auto-sync ketika provider berubah (bila API Key sudah ada)
    document.getElementById('ai-provider').addEventListener('change', () => {
        const apiKey = document.getElementById('api-key').value;
        if (apiKey || document.getElementById('ai-provider').value === 'openrouter') {
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

    // --- PRODUCT MODAL LOGIC ---
    const modal = document.getElementById('product-modal');
    const closeBtns = document.querySelectorAll('.close-modal');
    
    document.getElementById('btn-add-product').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('modal-title').textContent = 'Tambah Produk';
        modal.classList.add('active');
    });

    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    });

    // Handle Form Submit (Add/Update)
    document.getElementById('product-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('product-id').value;
        const product = {
            kategori: document.getElementById('product-category').value,
            nama_produk: document.getElementById('product-name').value,
            harga: parseInt(document.getElementById('product-price').value),
            keterangan: document.getElementById('product-desc').value
        };

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/products/${id}` : '/api/products';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(product)
            });
            const data = await response.json();
            
            if (data.success) {
                showToast(id ? 'Produk diperbarui' : 'Produk ditambahkan');
                modal.classList.remove('active');
                loadProducts();
            } else {
                showToast(data.error || 'Gagal menyimpan', true);
            }
        } catch (err) {
            showToast('Terjadi kesalahan jaringan', true);
        }
    });

    // Global Functions for inline onclick handlers
    window.editProduct = (id, cat, name, price, desc) => {
        document.getElementById('product-id').value = id;
        document.getElementById('product-category').value = cat;
        document.getElementById('product-name').value = name;
        document.getElementById('product-price').value = price;
        document.getElementById('product-desc').value = desc === 'null' ? '' : desc;
        
        document.getElementById('modal-title').textContent = 'Edit Produk';
        modal.classList.add('active');
    };

    window.deleteProduct = async (id) => {
        if (!confirm('Apakah Anda yakin ingin menghapus produk ini?')) return;
        
        try {
            const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            const data = await response.json();
            if (data.success) {
                showToast('Produk dihapus');
                loadProducts();
            } else {
                showToast(data.error, true);
            }
        } catch (err) {
            showToast('Gagal menghapus produk', true);
        }
    };

    // Initialize
    loadAIConfig();
    loadProducts();
});
