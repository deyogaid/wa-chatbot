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
                
                // Profil Perusahaan
                document.getElementById('company-email').value = data.config.company_email || '';
                document.getElementById('company-address').value = data.config.company_address || '';
                document.getElementById('company-social').value = data.config.company_social || '';
                document.getElementById('company-maps').value = data.config.company_maps || '';
                document.getElementById('business-context').value = data.config.business_context || '';

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
            business_context: document.getElementById('business-context').value
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
    window.loadProducts = async function() {
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

    // Panggil fungsi awal
    loadAIConfig();
    loadProducts();
    loadFaqs();
    fetchAlerts();
    
    // Polling untuk notifikasi setiap 10 detik
    setInterval(fetchAlerts, 10000);

    // --- SYSTEM ALERTS ---
    const bellIcon = document.getElementById('notification-bell');
    const dropdown = document.getElementById('notification-dropdown');
    const badge = document.getElementById('notification-badge');
    const alertList = document.getElementById('notification-list');
    const btnRead = document.getElementById('btn-read-alerts');

    bellIcon.addEventListener('click', (e) => {
        // Toggle dropdown if clicked on the bell wrapper (but not inner buttons)
        if (e.target.closest('#btn-read-alerts')) return;
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#notification-bell')) {
            dropdown.style.display = 'none';
        }
    });

    async function fetchAlerts() {
        try {
            const response = await fetch('/api/alerts');
            const data = await response.json();
            if (data.success) {
                if (data.unreadCount > 0) {
                    badge.style.display = 'block';
                    badge.textContent = data.unreadCount > 9 ? '9+' : data.unreadCount;
                } else {
                    badge.style.display = 'none';
                }

                alertList.innerHTML = '';
                if (data.alerts.length === 0) {
                    alertList.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Semua sistem normal.</div>';
                } else {
                    data.alerts.forEach(alert => {
                        const date = new Date(alert.timestamp).toLocaleString('id-ID');
                        const div = document.createElement('div');
                        div.className = `alert-item ${alert.is_read ? '' : 'unread'}`;
                        div.innerHTML = `
                            <p>${alert.message}</p>
                            <small>${date}</small>
                        `;
                        alertList.appendChild(div);
                    });
                }
            }
        } catch (err) {
            console.error("Gagal mengambil notifikasi", err);
        }
    }

    btnRead.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/alerts/read', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                badge.style.display = 'none';
                fetchAlerts();
            }
        } catch (err) {
            console.error("Gagal menandai notifikasi", err);
        }
    });

    // --- FAQS CRUD ---
    async function loadFaqs() {
        const tbody = document.getElementById('faq-list');
        try {
            const response = await fetch('/api/faqs');
            const data = await response.json();
            if (data.success) {
                tbody.innerHTML = '';
                if (data.faqs.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">Belum ada Balasan Cepat</td></tr>';
                    return;
                }
                data.faqs.forEach(faq => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${faq.command}</strong></td>
                        <td style="white-space: pre-wrap; font-size: 0.9em; max-width: 300px;">${faq.response}</td>
                        <td>
                            <div style="display: flex; gap: 5px;">
                                <button class="btn btn-sm btn-secondary btn-edit-faq" data-id="${faq.id}" data-faq='${JSON.stringify(faq).replace(/'/g, "&#39;")}'>Edit</button>
                                <button class="btn btn-sm btn-danger btn-delete-faq" data-id="${faq.id}">Hapus</button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                document.querySelectorAll('.btn-edit-faq').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const faq = JSON.parse(e.target.getAttribute('data-faq'));
                        document.getElementById('faq-id').value = faq.id;
                        document.getElementById('faq-command').value = faq.command;
                        document.getElementById('faq-response').value = faq.response;
                        document.getElementById('faq-modal-title').textContent = 'Edit Balasan Cepat';
                        document.getElementById('faq-modal').classList.add('show');
                    });
                });

                document.querySelectorAll('.btn-delete-faq').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Yakin ingin menghapus Balasan Cepat ini?')) {
                            const id = e.target.getAttribute('data-id');
                            await fetch(`/api/faqs/${id}`, { method: 'DELETE' });
                            showToast('Balasan Cepat dihapus');
                            loadFaqs();
                        }
                    });
                });
            }
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: red;">Gagal memuat data</td></tr>';
        }
    }

    document.getElementById('faq-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('faq-id').value;
        const faqData = {
            command: document.getElementById('faq-command').value,
            response: document.getElementById('faq-response').value
        };

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/faqs/${id}` : '/api/faqs';

        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(faqData)
            });
            const data = await response.json();
            if (data.success) {
                showToast(id ? 'FAQ diperbarui' : 'FAQ ditambahkan');
                closeFaqModal();
                loadFaqs();
            } else {
                showToast(data.error || 'Gagal menyimpan', true);
            }
        } catch (err) {
            showToast('Kesalahan jaringan', true);
        }
    });

    window.showFaqModal = () => {
        document.getElementById('faq-id').value = '';
        document.getElementById('faq-form').reset();
        document.getElementById('faq-modal-title').textContent = 'Tambah Balasan Cepat';
        document.getElementById('faq-modal').classList.add('show');
    };

    window.closeFaqModal = () => {
        document.getElementById('faq-modal').classList.remove('show');
    };
});
