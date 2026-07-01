/**
 * gemini.js - API Key 1 (Pro Key)
 * Queries Gemini models with Google Search grounding for music metadata.
 * Uses the new @google/genai SDK matching the Python DO_NOT_EDIT/gemini.py implementation.
 */
const API_KEY = "AIzaSyBts6AZ4KbXQ5XtphKOA2Aqjg3ofi-SUVQ";

async function ask_ai(filename, folder_name, tags) {
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                module: 'gemini',
                filename: filename,
                folder_name: folder_name,
                tags: tags
            })
        });
        const data = await response.json();
        if (data.error) {
            return [null, data.error];
        }
        return [data.result, null];
    } catch (err) {
        return [null, err.message];
    }
}

/* Expose module on window for script.js consumption */
window.gemini = {
    API_KEY,
    ask_ai
};
