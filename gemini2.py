import json
import logging
import time
from google import genai
from google.genai import types

from pydantic import BaseModel, Field
from typing import Optional

logger = logging.getLogger(__name__)

import os
from dotenv import load_dotenv
load_dotenv()

# API Key voor deze module loaded from environment variable
API_KEY = os.getenv("GEMINI_KEY_2")
# Modellen voor de Free Key (in volgorde van voorkeur/prioriteit)
MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro"
]

class MusicMetadata(BaseModel):
    """
    Representeert de gestructureerde metadata voor een muziekbestand.
    Dit schema toont de gewenste structuur van de JSON-output.
    """
    titel: str = Field(description="De officiële titel van het nummer. Lege string indien onbekend.")
    artiesten: str = Field(description="De artiest of artiesten van het nummer (komma-gescheiden indien meerdere). Lege string indien onbekend.")
    jaar: Optional[int] = Field(description="Het 4-cijferige jaar van uitgave (bijv. 1995). Moet null/None zijn indien onbekend.")
    album: str = Field(description="De naam van het album of single-release. Lege string indien onbekend.")
    track: Optional[int] = Field(description="Het tracknummer op het album. Moet null/None zijn indien onbekend.")
    unknown: bool = Field(description="Zet dit op true als het nummer/de metadata niet met hoge zekerheid kan worden gevonden via Google Zoeken.")

def get_thinking_config(model_name: str) -> types.ThinkingConfig | None:
    """
    Bepaalt de juiste thinking_config op basis van de modelnaam en versie.
    - Gemini 3.x/3.5 Flash/Pro/Lite -> LOW
    - Gemini 2.5 modellen -> 256 tokens budget
    """
    if "gemini-3" in model_name:
        return types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
    elif "gemini-2.5" in model_name:
        return types.ThinkingConfig(thinking_budget=256)
    return None

def extract_json(raw_text: str) -> dict:
    """
    Extraheert en parset een JSON-object op een robuuste manier uit de ruwe modelrespons.
    Dit vangt eventuele markdown codeblocks (```json) of extra tekst voor/na de JSON op.
    """
    raw_text = raw_text.strip()
    if raw_text.startswith("```"):
        lines = raw_text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw_text = "\n".join(lines).strip()
    
    start_idx = raw_text.find('{')
    end_idx = raw_text.rfind('}')
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        raw_text = raw_text[start_idx:end_idx+1]
        
    return json.loads(raw_text)

def ask_ai(filename, folder_name, tags):
    """
    Vraagt metadata aan Gemini met API Key 2 (Free Key) via een opeenvolgende fallback-lijst van 5 modellen.
    Dwingt een strikte JSON-structuur af via prompt-instructies en robuuste extractie.
    """
    client = genai.Client(api_key=API_KEY)
    tags_json = json.dumps(tags)
    
    # Verbeterde prompt specifiek gericht op gerichte zoekopdrachten
    prompt = (
        "Gebruik Google Zoeken om de officiële metadata voor het volgende muziekbestand te vinden.\n"
        f"Bestandsnaam: {filename}\n"
        f"Mapnaam (context): {folder_name}\n"
        f"Bestaande metadata tags: {tags_json}\n\n"
        "Bepaal de officiële titel, artiesten (komma-gescheiden indien meerdere), het releasejaar (4-cijferig getal), "
        "het album/de single-release en het tracknummer op dat album."
    )
    
    # Verbeterde systeeminstructies voor maximale nauwkeurigheid en structuur
    system_instr = (
        "Je bent een expert in muziek-metadata. Gebruik Google Zoeken voor uiterste nauwkeurigheid.\n"
        "Raadpleeg databases zoals Discogs, MusicBrainz, Wikipedia en songtekst-websites om de exact kloppende gegevens te vinden.\n"
        "Antwoord ALTIJD en UITSLUITEND met een valide JSON object dat exact deze structuur heeft:\n"
        '{"titel": "...", "artiesten": "...", "jaar": 1995, "album": "...", "track": 1, "unknown": false}\n'
        "STRIKTE REGELS:\n"
        "- Geef GEEN inleiding, GEEN uitleg, GEEN markdown-codeblocks. Begin direct met { en eindig met }.\n"
        "- Vul 'jaar' in als een 4-cijferig getal (bijv. 1995). Geen datums of tekst.\n"
        "- Als je niet 100% zeker bent over de match, zet 'unknown' op true, laat tekstvelden leeg ('') en zet getallen op null/None."
    )

    def try_model(model_name):
        """
        Voert een generate_content aanroep uit voor een specifiek model.
        Retourneert het JSON-resultaat bij succes, of de foutcode/foutmelding bij falen.
        """
        logger.info(f"[Gemini 2] Proberen met model: {model_name}")
        try:
            res = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instr,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    thinking_config=get_thinking_config(model_name)
                )
            )
            
            result = extract_json(res.text)
            if result.get('unknown'):
                return None, "unknown"
            return result, None
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "exhausted" in err_str.lower():
                return None, "exhausted"
            return None, err_str

    # Loop lineair door de prioriteitslijst van modellen heen
    last_err = None
    for model in MODELS:
        result, err = try_model(model)
        if result:
            return result, None
        last_err = err
        
        # Voeg een kleine pauze toe bij een rate limit om de API rust te geven
        if err == "exhausted":
            time.sleep(1)
            
    return None, last_err
