/**
 * gemini3.js - API Key 3 (Free Key)
 * Queries Gemini models with Google Search grounding for music metadata.
 * Uses the new @google/genai SDK matching the Python DO_NOT_EDIT/gemini3.py implementation.
 */
import { GoogleGenAI } from '@google/genai';

/* API Key 3 (Free Key) */
const API_KEY = "AIzaSyDl9YsbuQaQBmqwfRrvngdxDP_0V8k9bDM";

/* Model fallback priority list (matches DO_NOT_EDIT/gemini3.py) */
const MODELS = [
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite"
];

/**
 * Determines thinking config based on model name.
 * @param {string} modelName
 * @returns {object|undefined}
 */
function getThinkingConfig(modelName) {
    if (modelName.includes("gemini-3")) {
        if (modelName.includes("lite")) {
            return { thinkingLevel: "MEDIUM" };
        } else {
            return { thinkingLevel: "LOW" };
        }
    } else if (modelName.includes("gemini-2.5")) {
        return { thinkingBudget: 1024 };
    }
    return undefined;
}

/**
 * Extracts JSON from raw model response text, handling markdown codeblocks.
 * @param {string} rawText
 * @returns {object}
 */
function extractJson(rawText) {
    let text = rawText.trim();
    if (text.includes("```")) {
        const parts = text.split("```");
        for (let part of parts) {
            let p = part.trim();
            if (p.startsWith("json")) p = p.slice(4).trim();
            if (p.startsWith("{") && p.endsWith("}")) { text = p; break; }
        }
    }
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) text = text.slice(s, e + 1);
    return JSON.parse(text);
}

/**
 * Queries Gemini with API Key 3 via sequential model fallback.
 * Uses Google Search grounding for accurate music metadata retrieval.
 * @param {string} filename
 * @param {string} folder_name
 * @param {object} tags
 * @returns {Promise<[object|null, string|null]>}
 */
async function ask_ai(filename, folder_name, tags) {
    const tagsJson = JSON.stringify(tags);
    const prompt = `Gebruik Google Zoeken om de officiële metadata voor het volgende muziekbestand te vinden.\n` +
                   `Bestandsnaam: ${filename}\nMapnaam (context): ${folder_name}\n` +
                   `Bestaande metadata tags: ${tagsJson}\n\n` +
                   `Bepaal de officiële titel, artiesten (komma-gescheiden indien meerdere), het releasejaar (4-cijferig getal), ` +
                   `het album/de single-release en het tracknummer op dat album.`;

    const systemInstruction = `Je bent een expert in muziek-metadata. Gebruik Google Zoeken voor uiterste nauwkeurigheid.\n` +
                              `Raadpleeg databases zoals Discogs, MusicBrainz, Wikipedia en songtekst-websites om de exact kloppende gegevens te vinden.\n` +
                              `Antwoord ALTIJD en UITSLUITEND met een valide JSON object dat exact deze structuur heeft:\n` +
                              `{"titel": "...", "artiesten": "...", "jaar": 1995, "album": "...", "track": 1, "unknown": false}\n` +
                              `STRIKTE REGELS:\n` +
                              `- Geef GEEN inleiding, GEEN uitleg, GEEN markdown-codeblocks. Begin direct met { en eindig met }.\n` +
                              `- Vul 'jaar' in als een 4-cijferig getal (bijv. 1995). Geen datums of tekst.\n` +
                              `- Als je niet 100% zeker bent over de match, zet 'unknown' op true, laat tekstvelden leeg ('') en zet getallen op null.`;

    const client = new GoogleGenAI({ apiKey: API_KEY });
    let lastError = null;

    for (let modelName of MODELS) {
        try {
            console.log(`[Gemini 3] Proberen met model: ${modelName}`);
            const config = {
                systemInstruction: systemInstruction,
                tools: [{ googleSearch: {} }],
                thinkingConfig: getThinkingConfig(modelName)
            };
            const res = await client.models.generateContent({
                model: modelName, contents: prompt, config: config
            });
            const metadata = extractJson(res.text);
            if (metadata.unknown) return [null, "unknown"];
            return [metadata, null];
        } catch (err) {
            lastError = err;
            console.warn(`[Gemini 3] Failed with model ${modelName}: ${err.message}`);
            if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('exhausted')) {
                return [null, "exhausted"];
            }
            if (lastError) await new Promise(r => setTimeout(r, 1000));
        }
    }
    return [null, lastError ? lastError.message : "unknown"];
}

window.gemini3 = { API_KEY, ask_ai };
