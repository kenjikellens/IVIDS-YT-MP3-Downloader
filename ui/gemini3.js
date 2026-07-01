/**
 * gemini3.js - API Key 3 (Free Key)
 * Queries Gemini models with Google Search grounding for music metadata.
 * Uses the new @google/genai SDK matching the Python DO_NOT_EDIT/gemini3.py implementation.
 */
const API_KEY = "AIzaSyDl9YsbuQaQBmqwfRrvngdxDP_0V8k9bDM";

async function ask_ai(filename, folder_name, tags) {
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                module: 'gemini3',
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

window.gemini3 = { API_KEY, ask_ai };
