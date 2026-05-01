const db = require('../database.js');
const AIFactory = require('../ai_factory.js');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });
const { sendMessageWTyping } = require('./utils.js');

async function buildDynamicSystemPrompt(userId) {
    const aiConfig = await db.getAIConfig(userId);
    const products  = await db.getProducts(userId);

    const categories = {};
    products.forEach(p => {
        if (!categories[p.kategori]) categories[p.kategori] = [];
        const harga = Number(p.harga).toLocaleString('id-ID');
        const ket   = p.keterangan ? ` (${p.keterangan})` : '';
        categories[p.kategori].push(`- ${p.nama_produk}${ket}: Rp${harga}`);
    });

    const priceListString = Object.entries(categories)
        .map(([cat, items]) => `\nKategori: *${cat}*\n${items.join('\n')}`)
        .join('\n');

    const businessName = aiConfig?.business_name || 'Toko Kami';
    const basePrompt   = aiConfig?.system_prompt  || `Anda adalah asisten virtual Customer Service untuk "${businessName}". Jawab dengan ramah dan informatif.`;

    let companyContext = '';
    if (aiConfig?.company_email)   companyContext += `- Email: ${aiConfig.company_email}\n`;
    if (aiConfig?.company_address) companyContext += `- Alamat: ${aiConfig.company_address}\n`;
    if (aiConfig?.company_social)  companyContext += `- Sosial Media: ${aiConfig.company_social}\n`;
    if (aiConfig?.company_maps)    companyContext += `- Google Maps: ${aiConfig.company_maps}\n`;
    if (aiConfig?.business_context) companyContext += `\nKonteks Bisnis:\n${aiConfig.business_context}\n`;

    const now = new Date();
    const wibTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    const wibDate = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' };
    const timeContext = `\n\n[Waktu Sekarang]: ${now.toLocaleDateString('id-ID', wibDate)}, pukul ${now.toLocaleTimeString('id-ID', wibTime)} WIB.`;

    const priceSection = priceListString
        ? `\n--- DAFTAR HARGA RESMI ---\n${priceListString}\n--- AKHIR DAFTAR HARGA ---`
        : '\n[Belum ada daftar harga. Sampaikan bahwa harga akan dikonfirmasi oleh tim kami.]';

    return `${basePrompt}\n\nATURAN UTAMA:\n1. JAWAB SINGKAT & JELAS: Langsung ke inti, hindari bertele-tele.\n2. GUNAKAN DAFTAR HARGA: Jangan menebak harga. Gunakan harga PASTI dari daftar.\n3. SAPA PERSONAL: Sapa pelanggan dengan nama jika tersedia.\n4. HITUNG OTOMATIS: Bantu hitung biaya jika diminta.\n\n--- PROFIL PERUSAHAAN ---\n${companyContext || '[Profil belum diisi. Isi di Dashboard → Pengaturan AI]'}\n${priceSection}${timeContext}`;
}

async function getAIReply(userText, history = [], customerName = null, userId = 'admin') {
    const config = await db.getAIConfig(userId);

    if (!config?.api_key) {
        return '⚙️ Sistem AI belum dikonfigurasi. Hubungi admin untuk mengatur API Key di Dashboard.';
    }

    const systemPrompt = await buildDynamicSystemPrompt(userId);
    const fullConfig   = { ...config, system_prompt: systemPrompt };

    logger.info(`[AI] Menghubungi provider: ${fullConfig.provider}`);
    return AIFactory.generateReply(fullConfig, userText, history, customerName);
}

async function handleAI(sock, msg, text, sender, customerName, userId = 'admin') {
    const userHistory = await db.getHistoryForJid(sender);
    await db.addMessageToHistory(sender, 'user', text);

    const reply = await getAIReply(text, userHistory, customerName, userId);
    if (reply) {
        await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', reply);
    }
}

async function summarizeConversation(history, userId = 'admin') {
    if (!history?.length) return null;
    const text   = history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'Bot'}: ${m.content}`).join('\n');
    const prompt = `Buat rangkuman singkat poin-poin penting dari percakapan CS ini:\n\n${text}`;
    const config = await db.getAIConfig(userId);
    if (!config?.api_key) return null;
    return AIFactory.generateReply(config, prompt, [], null);
}

module.exports = {
    getAIReply,
    handleAI,
    summarizeConversation
};
