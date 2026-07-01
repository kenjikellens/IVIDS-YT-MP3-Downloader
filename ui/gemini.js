import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = "AIzaSyBts6AZ4KbXQ5XtphKOA2Aqjg3ofi-SUVQ";

const MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite"
];

function extractJson(rawText) {
    let text = rawText.trim();
    if (text.includes("```")) {
        const parts = text.split("```");
        for (let part of parts) {
            let p = part.trim();
            if (p.startsWith("json")) {
                p = p.slice(4).trim();
            }
            if (p.startsWith("{") && p.endsWith("}")) {
                text = p;
                break;
            }
        }
    }
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        text = text.slice(startIdx, endIdx + 1);
    }
    return JSON.parse(text);
}

async function ask_ai(filename, folder_name, tags) {
    const tagsJson = JSON.stringify(tags);
    const prompt = `Gebruik Google Zoeken om de officiële metadata voor het volgende muziekbestand te vinden.\n` +
                   `Bestandsnaam: ${filename}\n` +
                   `Mapnaam (context): ${folder_name}\n` +
                   `Bestaande metadata tags: ${tagsJson}\n\n` +
                   `Bepaal de officiële titel, artiesten (komma-gescheiden indien meerdere), het releasejaar (4-cijferig getal), ` +
                   `het album/de single-release en het tracknummer op dat album.`;

    const systemInstruction = `Je bent een expert in muziek-metadata. Gebruik Google Zoeken voor uiterste nauwkeurigheid.\n` +
                              `Raadpleeg databases zoals Discogs, MusicBrainz, Wikipedia en songtekst-websites om de exact kloppende gegevens te vinden.\n` +
                              `Antwoord ALTIJD en UITSLUITEND met een valide JSON object dat exact deze structuur heeft:\n` +
                              `{"titel": "...", "artiesten": "...", "jaar": 1995, "album": "...", "track": 1, "unknown": false}\n` +
                              `STRIKTE REGELS:\n` +
                              `- Geef GEEN inleiding, GEEN uitleg, GEEN markdown-codeblocks. Begin direct met { en eindig met }.\n` +
                              `- Vul 'jaar' in als een 4-cijferig getal (bijv. 1995). Geen datums of tekst.`;

    const genAI = new GoogleGenerativeAI(API_KEY);
    let lastError = null;

    for (let modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction
            });

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            });

            const rawText = result.response.text();
            const metadata = extractJson(rawText);
            return [metadata, null];
        } catch (err) {
            lastError = err;
            console.warn(`[Gemini Pro] Failed with model ${modelName}: ${err.message}`);
            if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('exhausted')) {
                return [null, "exhausted"];
            }
        }
    }

    return [null, lastError ? lastError.message : "unknown"];
}

window.gemini = {
    API_KEY,
    ask_ai
};
