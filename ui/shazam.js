import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEYS = [
    "AIzaSyBts6AZ4KbXQ5XtphKOA2Aqjg3ofi-SUVQ",
    "AIzaSyC-UBpJAp5w4Uq233rzxGxBUd87N-LNruw",
    "AIzaSyDl9YsbuQaQBmqwfRrvngdxDP_0V8k9bDM"
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

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function ask_shazam(filepath) {
    const prompt = "Identificeer dit nummer op basis van de audio. " +
                   "Antwoord EXCLUSIEF in dit JSON-formaat: " +
                   '{"titel": "...", "artiesten": "...", "jaar": 1995, "album": "...", "track": 1, "unknown": false}. ' +
                   "Als je het niet zeker weet, zet 'unknown' op true. " +
                   "Gebruik voor 'jaar' alleen de 4 cijfers.";

    let lastError = null;

    try {
        console.log(`[Gemini Audio] Fetching file bytes from server: ${filepath}`);
        const fileResponse = await fetch('/api/get_file?path=' + encodeURIComponent(filepath));
        if (!fileResponse.ok) throw new Error("Failed to retrieve file bytes from python backend.");
        const blob = await fileResponse.blob();
        
        console.log(`[Gemini Audio] Converting to base64...`);
        const base64Data = await blobToBase64(blob);

        for (let apiKey of API_KEYS) {
            const genAI = new GoogleGenerativeAI(apiKey);

            try {
                console.log(`[Gemini Audio] Analyzing audio in browser...`);
                const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                
                const result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: "audio/mp3",
                            data: base64Data
                        }
                    },
                    { text: prompt }
                ]);

                const rawText = result.response.text();
                const metadata = extractJson(rawText);

                if (metadata.unknown) {
                    return [null, "unknown"];
                }

                const mapped = {
                    titel: metadata.titel || '',
                    artiesten: metadata.artiesten || metadata["artiest(en)"] || '',
                    jaar: metadata.jaar ? parseInt(metadata.jaar) : null,
                    album: metadata.album || '',
                    track: metadata.track ? parseInt(metadata.track) : null,
                    unknown: false
                };

                return [mapped, null];

            } catch (err) {
                lastError = err;
                console.warn(`[Gemini Audio] Failed with key: ${err.message}`);
            }
        }
    } catch (e) {
        lastError = e;
        console.error(`[Gemini Audio] Error fetching or converting file: ${e.message}`);
    }

    return [null, lastError ? lastError.message : "unknown"];
}

window.shazam = {
    ask_shazam
};
