import asyncio
import logging
import json
import os

# We gebruiken google-genai voor de audio-herkenning
try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

logger = logging.getLogger(__name__)

# Fallback voor API KEY als deze niet globaal is gedefinieerd
API_KEY = os.environ.get('GOOGLE_API_KEY')

async def recognize_audio(filepath):
    """Herken een nummer door naar de audio te 'luisteren' via Gemini 3 Flash."""
    
    if not GEMINI_AVAILABLE:
        return None, "Google GenAI bibliotheek niet geïnstalleerd."

    try:
        api_keys = []
        if API_KEY: api_keys.append(API_KEY)
        try:
            import gemini
            if getattr(gemini, 'API_KEY', None): api_keys.append(gemini.API_KEY)
        except: pass
        try:
            import gemini2
            if getattr(gemini2, 'API_KEY', None): api_keys.append(gemini2.API_KEY)
        except: pass
        try:
            import gemini3
            if getattr(gemini3, 'API_KEY', None): api_keys.append(gemini3.API_KEY)
        except: pass

        if not api_keys:
            return None, "Geen Gemini API Key gevonden."

        last_err = None
        
        safe_filepath = str(filepath).encode('ascii', 'replace').decode('ascii')
        logger.info(f"[Gemini Audio] Uploaden van audio: {safe_filepath}")
        
        for key in api_keys:
            try:
                client = genai.Client(api_key=key)
                
                # Upload het bestand naar de Gemini File API
                media_file = client.files.upload(file=filepath)
                
                prompt = (
                    "Identificeer dit nummer op basis van de audio. "
                    "Antwoord EXCLUSIEF in dit JSON-formaat: "
                    '{"titel": "...", "artiest(en)": "...", "jaar": "1995", "album": "...", "track": 1, "unknown": false}. '
                    "Als je het niet zeker weet, zet 'unknown' op true. "
                    "Gebruik voor 'jaar' alleen de 4 cijfers."
                )
                
                logger.info(f"[Gemini Audio] Analyseren door Gemini 3 Flash...")
                res = client.models.generate_content(
                    model="gemini-3-flash-preview",
                    contents=[prompt, media_file]
                )
                
                # Verwijder het bestand bij Google na verwerking
                try:
                    client.files.delete(name=media_file.name)
                except: pass

                raw_text = res.text.strip()
                if "```" in raw_text:
                    raw_text = raw_text.split("```")[1]
                    if raw_text.startswith("json"): raw_text = raw_text[4:]
                    raw_text = raw_text.strip()
                
                metadata = json.loads(raw_text)
                
                if metadata.get('unknown'):
                    return None, "unknown"
                    
                return metadata, None

            except Exception as e:
                err_str = str(e)
                last_err = err_str
                # If it's a leaked key or quota error, try the next key
                if "PERMISSION_DENIED" in err_str or "leaked" in err_str or "403" in err_str or "exhausted" in err_str.lower():
                    logger.warning(f"[Gemini Audio] Sleutel faalde ({err_str}), probeert de volgende...")
                    continue
                # For other errors, just stop and return
                logger.error(f"Gemini Audio Herkenning fout: {err_str}")
                return None, err_str

        return None, f"Alle API keys faalden. Laatste fout: {last_err}"

    except Exception as e:
        logger.error(f"Gemini Audio Herkenning algemene fout: {e}")
        return None, str(e)

def ask_shazam(filepath):
    """Sync wrapper voor de audio herkenning."""
    try:
        return asyncio.run(recognize_audio(filepath))
    except Exception as e:
        return None, str(e)

