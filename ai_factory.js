// =================================================================
// AI FACTORY — Universal AI Provider Handler
// Checkpoint aman: error handling + alert lengkap per provider
// =================================================================

const { OpenAI }             = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db                     = require('./database');

// -----------------------------------------------------------------
// Tabel error → pesan & solusi yang ditampilkan di dashboard
// -----------------------------------------------------------------
const ERROR_GUIDE = {
    401: {
        label:  '🔑 API Key Tidak Valid',
        action: 'Buka Dashboard → Konfigurasi AI → perbarui API Key Anda.',
    },
    402: {
        label:  '💳 Kredit Habis',
        action: 'Top up kredit di dashboard provider, lalu coba lagi.',
    },
    403: {
        label:  '🚫 Akses Ditolak',
        action: 'Periksa apakah API Key memiliki izin untuk model ini.',
    },
    429: {
        label:  '⏳ Rate Limit / Kuota Habis',
        action: 'Terlalu banyak permintaan. Ganti model lain atau tunggu beberapa menit.',
    },
    500: {
        label:  '🔥 Server Error Provider',
        action: 'Provider sedang bermasalah. Coba lagi nanti atau ganti model.',
    },
    503: {
        label:  '🔌 Model Tidak Tersedia',
        action: 'Model sedang offline. Pilih model lain di Konfigurasi AI.',
    },
};

// Ambil kode HTTP dari berbagai format error OpenAI/Axios
function parseHttpCode(error) {
    return (
        error?.status ||
        error?.response?.status ||
        error?.code ||
        (typeof error?.message === 'string' && parseInt(error.message.match(/\b(4\d\d|5\d\d)\b/)?.[0])) ||
        null
    );
}

// Bangun pesan alert yang lengkap dan actionable
function buildAlertMessage(provider, model, error) {
    const code  = parseHttpCode(error);
    const guide = ERROR_GUIDE[code];
    const raw   = error?.message || String(error);

    const lines = [
        `Provider : ${provider.toUpperCase()}`,
        `Model    : ${model}`,
        `Waktu    : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        ``,
    ];

    if (guide) {
        lines.push(`Status   : ${code} — ${guide.label}`);
        lines.push(`Tindakan : ${guide.action}`);
    } else {
        lines.push(`Error    : ${raw}`);
        lines.push(`Tindakan : Periksa koneksi internet dan konfigurasi API Key.`);
    }

    return lines.join('\n');
}

// -----------------------------------------------------------------
// AI FACTORY
// -----------------------------------------------------------------
class AIFactory {

    static async generateReply(config, userText, history = [], customerName = null) {
        if (!config || !config.api_key) {
            return 'Maaf, sistem CS sedang dalam pemeliharaan (API Key belum dikonfigurasi).';
        }

        const provider   = (config.provider || '').toLowerCase();
        const apiKey     = config.api_key;
        const modelName  = config.model || config.model_name || 'llama-3.3-70b-versatile';
        const systemPrmt = config.system_prompt || 'Anda adalah CS virtual.';
        const userId     = config.user_id || 'admin'; // ← dipastikan selalu ada

        try {
            switch (provider) {
                case 'gemini':
                    return await this.callGemini(apiKey, modelName, systemPrompt, userText, history, customerName);
                case 'groq':
                    return await this.callOpenAICompatible(apiKey, "https://api.groq.com/openai/v1", modelName, systemPrompt, userText, history, customerName);
                case 'openrouter':
                    return await this.callOpenAICompatible(apiKey, "https://openrouter.ai/api/v1", modelName, systemPrompt, userText, history, customerName);
                case 'openai':
                    return await this.callOpenAICompatible(apiKey, null, modelName, systemPrompt, userText, history, customerName);
                default:
                    throw new Error('Provider tidak didukung');
            }
        } catch (error) {
            // Log ke terminal
            console.error(`[AIFactory] ${provider}/${modelName} →`, error.message || error);

            // Simpan alert lengkap ke dashboard (fire & forget)
            const alertMsg = buildAlertMessage(provider, modelName, error);
            db.addSystemAlert(userId, alertMsg).catch(e =>
                console.error('[AIFactory] Gagal simpan alert:', e.message)
            );

            // Balas pelanggan dengan pesan generik
            return 'Maaf, terjadi gangguan pada sistem kami saat memproses pesan Anda. Silakan coba beberapa saat lagi.';
        }
    }

    // ── Gemini ──────────────────────────────────────────────────
    static async callGemini(apiKey, modelName, systemPrompt, userText, history, customerName) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        let fullPrompt = `${systemPrompt}\n\n`;
        if (customerName) fullPrompt += `[Nama Pelanggan]: "${customerName}"\n`;
        fullPrompt += `--- RIWAYAT CHAT ---\n`;
        if (history.length > 0) {
            fullPrompt += history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'CS'}: ${m.content}`).join('\n') + '\n';
        }
        fullPrompt += `\nPelanggan: ${userText}\nCS:`;

        const result = await model.generateContent(fullPrompt);
        return result.response.text().trim();
    }

    // ── OpenAI-compatible (Groq, OpenRouter, OpenAI) ────────────
    static async callOpenAICompatible(apiKey, baseURL, provider, modelName, systemPrompt, userText, history, customerName) {
        const clientConfig = { apiKey, timeout: 30000 };
        if (baseURL) clientConfig.baseURL = baseURL;

        if (provider === 'openrouter') {
            clientConfig.defaultHeaders = {
                'HTTP-Referer': process.env.APP_URL || 'https://localhost:3000',
                'X-Title':      process.env.APP_NAME || 'CSWA Bot',
            };
        }

        const openai = new OpenAI(clientConfig);

        let sysContent = systemPrompt;
        if (customerName) sysContent += `\nNama pelanggan yang sedang dilayani adalah: ${customerName}`;

        const messages = [
            { role: 'system', content: sysContent },
            ...history,
            { role: 'user', content: userText },
        ];

        const response = await openai.chat.completions.create({ model: modelName, messages });
        return response.choices[0]?.message?.content?.trim();
    }
}

module.exports = AIFactory;
