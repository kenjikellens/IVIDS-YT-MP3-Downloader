/**
 * gemini.js - API Key 1 (Pro Key)
 * Queries Gemini models with Google Search grounding for music metadata.
 * Uses the new @google/genai SDK matching the Python DO_NOT_EDIT/gemini.py implementation.
 */
import { GoogleGenAI } from '@google/genai';

/* API Key 1 (Pro Key) */
const API_KEY = "AIzaSyBts6AZ4KbXQ5XtphKOA2Aqjg3ofi-SUVQ";

/* Model fallback priority list (matches DO_NOT_EDIT/gemini.py) */
const MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite"
];

/**
 * Determines the thinking config based on model name and version.
 * - Gemini 3.x/3.5 Flash/Pro -> LOW
 * - Gemini 3.x/3.5 Flash Lite -> MEDIUM
 * - Gemini 2.5 models -> 1024 tokens budget
 * @param {string} modelName - The model identifier string
 * @returns {object|undefined} Thinking config object or undefined
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
 * Extracts and parses a JSON object from raw model response text.
 * Handles markdown codeblocks and extra surrounding text.
 * @param {string} rawText - Raw text response from the model
 * @returns {object} Parsed JSON object
 */
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

/**
 * Queries Gemini with API Key 1 via sequential model fallback list.
 * Uses Google Search grounding for accurate music metadata retrieval.
 * @param {string} filename - The music file name
 * @param {string} folder_name - Parent folder name for context
 * @param {object} tags - Existing ID3/metadata tags
 * @returns {Promise<[object|null, string|null]>} [result, error] tuple
 */
async function ask_ai(filename, folder_name, tags) {
    const tagsJson = JSON.stringify(tags);

    /* Prompt instructing the model to search for official music metadata */
    const prompt = `Gebruik Google Zoeken om de officiële metadata voor het volgende muziekbestand te vinden.\n` +
                   `Bestandsnaam: ${filename}\n` +
                   `Mapnaam (context): ${folder_name}\n` +
                   `Bestaande metadata tags: ${tagsJson}\n\n` +
                   `Bepaal de officiële titel, artiesten (komma-gescheiden indien meerdere), het releasejaar (4-cijferig getal), ` +
                   `het album/de single-release en het tracknummer op dat album.`;

    /* System instructions enforcing strict JSON output and search-based accuracy */
    const systemInstruction = `Je bent een expert in muziek-metadata. Gebruik Google Zoeken voor uiterste nauwkeurigheid.\n` +
                              `Raadpleeg databases zoals Discogs, MusicBrainz, Wikipedia en songtekst-websites om de exact kloppende gegevens te vinden.\n` +
                              `Antwoord ALTIJD en UITSLUITEND met een valide JSON object dat exact deze structuur heeft:\n` +
                              `{"titel": "...", "artiesten": "...", "jaar": 1995, "album": "...", "track": 1, "unknown": false}\n` +
                              `STRIKTE REGELS:\n` +
                              `- Geef GEEN inleiding, GEEN uitleg, GEEN markdown-codeblocks. Begin direct met { en eindig met }.\n` +
                              `- Vul 'jaar' in als een 4-cijferig getal (bijv. 1995). Geen datums of tekst.\n` +
                              `- Als je niet 100% zeker bent over de match, zet 'unknown' op true, laat tekstvelden leeg ('') en zet getallen op null.`;

    /* Initialize the new Google GenAI client */
    const client = new GoogleGenAI({ apiKey: API_KEY });
    let lastError = null;

    /* Loop through model priority list sequentially */
    for (let modelName of MODELS) {
        try {
            console.log(`[Gemini 1] Proberen met model: ${modelName}`);

            /* Build config with Google Search tool and thinking config */
            const config = {
                systemInstruction: systemInstruction,
                tools: [{ googleSearch: {} }],
                thinkingConfig: getThinkingConfig(modelName)
            };

            /* Execute the generateContent call with search grounding */
            const res = await client.models.generateContent({
                model: modelName,
                contents: prompt,
                config: config
            });

            const rawText = res.text;
            const metadata = extractJson(rawText);

            /* If model reports unknown, return error so caller can try next module */
            if (metadata.unknown) {
                return [null, "unknown"];
            }
            return [metadata, null];
        } catch (err) {
            lastError = err;
            console.warn(`[Gemini 1] Failed with model ${modelName}: ${err.message}`);

            /* On rate limit, return exhausted so caller handles backoff */
            if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('exhausted')) {
                return [null, "exhausted"];
            }

            /* On other errors, add small delay and try next model */
            if (lastError) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    return [null, lastError ? lastError.message : "unknown"];
}

/* Expose module on window for script.js consumption */
window.gemini = {
    API_KEY,
    ask_ai
};
