const { OpenAI } = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require("./database");

/**
 * AI Factory
 * Menghasilkan instance dan fungsi pemanggilan AI berdasarkan konfigurasi UMKM
 */
class AIFactory {
    static async generateReply(config, userText, history = [], customerName = null) {
        if (!config || !config.api_key) {
            return "Maaf, sistem CS sedang dalam pemeliharaan (API Key belum dikonfigurasi).";
        }

        const provider = config.provider.toLowerCase();
        const apiKey = config.api_key;
        const modelName = config.model_name || "llama-3.3-70b-versatile";
        const systemPrompt = config.system_prompt || "Anda adalah CS virtual.";

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
            console.error(`[AI Factory Error] Provider: ${provider}`, error.message);
            if (config.user_id) {
                // Jangan ditunggu (fire and forget) agar tidak memblokir respon WA
                db.addSystemAlert(config.user_id, `Gagal memproses pesan via ${provider}: ${error.message}`).catch(err => console.error('Gagal menyimpan alert', err));
            }
            return "Maaf, terjadi gangguan pada sistem kecerdasan buatan kami saat memproses pesan Anda.";
        }
    }

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

    static async callOpenAICompatible(apiKey, baseURL, modelName, systemPrompt, userText, history, customerName) {
        const clientConfig = { apiKey: apiKey, timeout: 30000 };
        if (baseURL) clientConfig.baseURL = baseURL;
        if (baseURL && baseURL.includes('openrouter')) {
            clientConfig.defaultHeaders = {
                "HTTP-Referer": "https://kartinidigitalprinting.com",
                "X-Title": "KartiniBot SaaS"
            };
        }

        const openai = new OpenAI(clientConfig);
        
        let sysContent = systemPrompt;
        if (customerName) sysContent += `\nNama pelanggan yang sedang dilayani adalah: ${customerName}`;

        const messages = [
            { role: "system", content: sysContent },
            ...history,
            { role: "user", content: userText }
        ];

        const response = await openai.chat.completions.create({
            model: modelName,
            messages: messages
        });

        return response.choices[0]?.message?.content?.trim();
    }
}

module.exports = AIFactory;
