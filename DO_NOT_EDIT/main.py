import time
import os
import sys
import json
import shutil
import logging
import re
import webbrowser
import queue
from threading import Timer
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import mutagen

import gemini
import gemini2
import gemini3
import shazam

# Initialiseer de Flask-applicatie
app = Flask(__name__)
CORS(app)

# Configureer logging voor de applicatie
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("app.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Thread-safe log queue voor de live UI-terminal
log_queue = queue.Queue(maxsize=300)

class QueueHandler(logging.Handler):
    """
    Custom logging handler die alle logs doorstroomt naar een thread-safe queue.
    Hierdoor kan de frontend real-time serverlogs ophalen via Server-Sent Events (SSE).
    """
    def emit(self, record):
        try:
            msg = self.format(record)
            log_queue.put_nowait(msg)
        except queue.Full:
            try:
                # Verwijder het oudste logbericht om plaats te maken voor het nieuwe bericht
                log_queue.get_nowait()
                log_queue.put_nowait(msg)
            except queue.Empty:
                pass
        except Exception:
            self.handleError(record)

# Registreer de QueueHandler bij de root logger om logs van alle modules te vangen
queue_handler = QueueHandler()
queue_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logging.getLogger().addHandler(queue_handler)


# Teller voor het verdelen van de AI-aanvragen over de Gemini-modules
request_counter = 0

# Pad naar het persistente databasebestand met reeds verwerkte bestands-ID's
DB_PATH = "processed_log.json"

# Categorieën voor de jaar-mappen
YEAR_CATEGORIES = {
    "40's": range(1940, 1950),
    "50's": range(1950, 1960),
    "60's": range(1960, 1970),
    "70's": range(1970, 1980),
    "80's": range(1980, 1990),
    "90's": range(1990, 2000),
    "2000-2005": range(2000, 2006),
    "2006-2010": range(2006, 2011),
    "2011-2015": range(2011, 2016),
    "2016-2020": range(2016, 2021),
    "2021-2025": range(2021, 2026),
    "2026-2030": range(2026, 2031)
}

def load_log():
    """
    Laadt de lijst van reeds verwerkte bestands-ID's uit het JSON-bestand.
    Retourneert een set met unieke ID's.
    """
    if not os.path.exists(DB_PATH):
        return set()
    try:
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            return set(json.load(f))
    except Exception as e:
        logger.error(f"Fout bij laden log: {e}")
        return set()

def save_log(processed_set):
    """
    Slaat de bijgewerkte set van verwerkte bestands-ID's op in het JSON-bestand.
    """
    try:
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(list(processed_set), f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Fout bij opslaan log: {e}")

def get_year_category(year):
    """
    Bepaalt de juiste mapnaam (categorie) op basis van het releasejaar.
    Als het jaar ongeldig of voor 1940 is, retourneert het 'onbekend'.
    """
    try:
        y = int(year)
        for cat, r in YEAR_CATEGORIES.items():
            if y in r:
                return cat
    except Exception:
        pass
    return "onbekend"

def clean_filename(name):
    """
    Schoont een bestandsnaam op door ongeldige karakters te verwijderen.
    """
    if not name:
        return "Onbekend"
    cleaned = re.sub(r'[<>:"/\\|?*]', '', str(name))
    return cleaned.strip()

@app.route('/')
def index():
    """
    Serveert de hoofdpagina (index.html) van de frontend.
    """
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    """
    Serveert statische bestanden (zoals CSS, JS en afbeeldingen) vanuit de static map.
    """
    return send_from_directory('static', path)

@app.route('/api/scan', methods=['POST'])
def scan():
    """
    Scant de opgegeven bronmap op audiobestanden (.mp3, .m4a, .flac, .wav).
    Filtert reeds verwerkte bestanden uit en leest de bestaande metadata-tags.
    """
    try:
        data = request.json
        source_dir = data.get('source_dir')
        if not source_dir or not os.path.exists(source_dir):
            return jsonify({"error": "Bronmap bestaat niet"}), 400
            
        processed = load_log()
        files_to_process = []
        
        for root, _, filenames in os.walk(source_dir):
            for filename in filenames:
                if filename.lower().endswith(('.mp3', '.m4a', '.flac', '.wav')):
                    full_path = os.path.join(root, filename)
                    try:
                        size = os.path.getsize(full_path)
                        file_id = f"{size}_{filename}"
                        
                        # De check voor reeds verwerkte bestanden is uitgeschakeld zodat
                        # bestanden in de invoermap altijd opnieuw worden verwerkt.
                        # if file_id in processed:
                        #     continue
                            
                        # Bepaal of het bestand direct in de bronmap staat of in een submap
                        # Zorgt ervoor dat de naam van de inputmap zelf niet als submap in de output verschijnt.
                        norm_root = os.path.normpath(root)
                        norm_source = os.path.normpath(source_dir)
                        folder_name = "" if norm_root == norm_source else os.path.basename(root)
                        
                        tags = {}
                        try:
                            audio = mutagen.File(full_path, easy=True)
                            if audio is not None:
                                for key in ['title', 'artist', 'album', 'date', 'tracknumber']:
                                    if key in audio:
                                        tags[key] = audio[key][0]
                        except Exception as te:
                            logger.debug(f"Kon tags niet lezen voor {filename}: {te}")
                            
                        files_to_process.append({
                            "id": file_id,
                            "filename": filename,
                            "full_path": full_path,
                            "folder_name": folder_name,
                            "tags": tags
                        })
                    except Exception as fe:
                        logger.error(f"Fout bij scannen bestand {filename}: {fe}")
                        
        return jsonify({"files": files_to_process})
    except Exception as e:
        logger.error(f"Fout in scan: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    """
    Sluit de Flask-server op een nette manier af na een kleine vertraging.
    """
    logger.info("Systeem wordt afgesloten op verzoek van gebruiker...")
    def stop_server():
        os._exit(0)
    Timer(0.5, stop_server).start()
    return jsonify({"status": "Shutting down..."})
import subprocess

@app.route('/api/select_folder', methods=['POST'])
def select_folder():
    """
    Opent een native OS map-selectiedialog via een apart python-proces.
    Dit voorkomt threadblokkades in de Flask-server op Windows en zorgt
    ervoor dat de dialoog altijd netjes op de voorgrond wordt getoond.
    """
    script = (
        "import sys, tkinter as tk; "
        "from tkinter import filedialog; "
        "root = tk.Tk(); "
        "root.withdraw(); "
        "root.attributes('-topmost', True); "
        "selected = filedialog.askdirectory(title='Selecteer een map'); "
        "print(selected or ''); "
        "sys.exit(0)"
    )
    try:
        # Start een subproces om de tkinter-dialoog uit te voeren
        res = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            timeout=180,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        logger.info(f"Mapselectie subprocess stdout: '{res.stdout.strip()}', stderr: '{res.stderr.strip()}'")
        selected_path = res.stdout.strip().replace("/", "\\")
        return jsonify({"folder": selected_path})
    except Exception as e:
        logger.error(f"Fout bij openen mapselectiedialog: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/defaults', methods=['GET'])
def get_defaults():
    """
    Retourneert het standaard Downloads-pad van de huidige gebruiker.
    Dit pad wordt gebruikt als terugvaloptie in de frontend wanneer er
    nog geen paden zijn opgeslagen in de localStorage van de browser.
    """
    try:
        downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
        return jsonify({"downloads_dir": os.path.normpath(downloads_dir)})
    except Exception as e:
        logger.error(f"Fout bij bepalen van standaard downloads map: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/log_stream')
def log_stream():
    """
    Server-Sent Events (SSE) endpoint dat live logberichten uit de queue streamt.
    De frontend gebruikt EventSource om deze stroom te lezen en in de console te tonen.
    """
    def generate():
        # Stuur een initiële verbindingbevestiging
        yield "data: [SYSTEM] Verbonden met log-stream...\n\n"
        while True:
            try:
                # Wacht maximaal 1.0 seconde op een nieuw logbericht
                msg = log_queue.get(timeout=1.0)
                yield f"data: {msg}\n\n"
            except queue.Empty:
                # Stuur een leeg bericht als keep-alive om de verbinding open te houden
                yield "data: \n\n"
            except Exception as ge:
                logger.error(f"Fout in log_stream generator: {ge}")
                break
    return Response(generate(), mimetype='text/event-stream')



@app.route('/api/ai_query', methods=['POST'])
def ai_query():
    global request_counter
    data = request.json
    filename = data.get('filename')
    folder_name = data.get('folder_name', 'Onbekend')
    tags = data.get('tags', {})
    
    # Bepaal de start-module op basis van het gevraagde patroon (1 -> 2 -> 1 -> 3)
    pattern = [gemini, gemini2, gemini, gemini3]
    primary_mod = pattern[request_counter % 4]
    request_counter += 1
    
    # Bepaal de failover volgorde afhankelijk van de primaire module
    if primary_mod == gemini:
        modules = [gemini, gemini2, gemini3]
    elif primary_mod == gemini2:
        modules = [gemini2, gemini, gemini3]
    else:
        modules = [gemini3, gemini, gemini2]
    
    last_err = None
    for i, mod in enumerate(modules):
        mod_name = "Gemini 1 (Pro)" if mod == gemini else ("Gemini 2" if mod == gemini2 else "Gemini 3")
        logger.info(f"[{mod_name}] Route-poging {i+1} gestart voor: {filename}")
        
        # Voer retries uit met exponential backoff als er een 429 rate limit is
        max_retries = 3
        backoff = 2  # start met 2 seconden wachttijd
        
        for attempt in range(max_retries):
            result, err = mod.ask_ai(filename, folder_name, tags)
            
            if result:
                return jsonify(result)
                
            if err == "unknown":
                # Het model wist het niet, ga direct door naar de volgende module in de failover-lijst
                logger.info(f"[{mod_name}] Model wist het niet ('unknown'). Overschakelen...")
                last_err = err
                break
                
            # Als er een rate limit (429) optreedt, voer dan een retry uit na wachttijd
            if err == "exhausted" or (isinstance(err, str) and "429" in err):
                logger.warning(f"[{mod_name}] Rate limit geraakt. Poging {attempt+1}/{max_retries}. Wachten op backoff van {backoff}s...")
                time.sleep(backoff)
                backoff *= 2  # verdubbel de wachttijd voor de volgende poging
                last_err = err
                continue
                
            # Bij andere technische fouten direct door naar de volgende module
            logger.warning(f"[{mod_name}] Technisch probleem: {err}. Overschakelen...")
            last_err = err
            break


    # 3. Probeer Shazam (Audio Herkenning) als laatste redmiddel
    # Dit is vooral voor bestandsnamen als 'track01.mp3' zonder tags
    # 3. Probeer Audio Herkenning (via Gemini 3 Flash) als laatste redmiddel
    # Dit is vooral voor bestandsnamen als 'track01.mp3' zonder tags
    if getattr(shazam, 'GEMINI_AVAILABLE', False):
        logger.info(f"AI wist het niet via tekst, proberen met Gemini Audio voor: {filename}...")
        result, err = shazam.ask_shazam(data.get('full_path'))
        if result: return jsonify(result)
        if err == "unknown":
            return jsonify({"unknown": True, "error": "Nummer niet gevonden door AI Tekst of Audio"})
    else:
        logger.warning("Gemini Audio is niet geconfigureerd, dit nummer wordt als onbekend gemarkeerd.")
        return jsonify({"unknown": True, "error": "AI wist het niet en Gemini Audio is niet beschikbaar"})

    return jsonify({"error": f"Alle systemen faalden. Laatste fout: {err}"}), 500

@app.route('/api/finalize', methods=['POST'])
def finalize():
    try:
        data = request.json
        file_info = data['file_info']
        ai_data = data['ai_data']
        target_base = data['target_dir']
        
        source_path = file_info['full_path']
        
        if ai_data.get('unknown'):
            # Kopieer naar 'onbekend' folder
            dest_dirs = [os.path.join(target_base, "onbekend")]
            new_filename = file_info['filename']
        else:
            # Bepaal categorieën
            year_val = ai_data.get('jaar')
            year_cat = get_year_category(year_val)
            original_folder = file_info.get('folder_name', '')
            
            # Haal de artiestnaam op; controleer zowel 'artiesten' (Gemini) als 'artiest(en)' (Shazam)
            artist = clean_filename(ai_data.get('artiesten') or ai_data.get('artiest(en)') or 'Onbekend')
            title = clean_filename(ai_data.get('titel', 'Onbekend'))
            ext = os.path.splitext(source_path)[1]
            new_filename = f"{artist} - {title}{ext}"
            
            dest_dirs = []
            # 1. Altijd naar de jaartal map
            dest_dirs.append(os.path.join(target_base, year_cat))
            
            # 2. Als de originele map speciaal is (geen jaartal map), dan ook daarheen
            if original_folder and original_folder not in YEAR_CATEGORIES and original_folder.lower() != "jaar":
                dest_dirs.append(os.path.join(target_base, original_folder))

        # Voer de kopie-actie(s) uit
        for dest_dir in dest_dirs:
            if not os.path.exists(dest_dir):
                os.makedirs(dest_dir)
                
            dest_path = os.path.join(dest_dir, new_filename)
            shutil.copy2(source_path, dest_path)
            
            # Schrijf tags naar de kopie
            if not ai_data.get('unknown'):
                try:
                    audio = mutagen.File(dest_path, easy=True)
                    if audio is not None:
                        # Schrijf de artiestennaam naar de ID3 tag
                        audio['artist'] = ai_data.get('artiesten') or ai_data.get('artiest(en)') or ''
                        audio['title'] = ai_data.get('titel', '')
                        audio['album'] = ai_data.get('album', '')
                        y_str = str(ai_data.get('jaar', '')).split('-')[0]
                        audio['date'] = y_str
                        if ai_data.get('track'):
                            audio['tracknumber'] = str(ai_data.get('track'))
                        audio.save()
                except Exception as tag_err:
                    logger.error(f"Fout bij schrijven tags naar {dest_path}: {tag_err}")

        # Update log
        processed = load_log()
        processed.add(file_info['id'])
        save_log(processed)
        
        return jsonify({"status": "Succes", "result": "Verwerkt"})
    except Exception as e:
        logger.error(f"Fout in finalize: {e}")
        return jsonify({"error": str(e)}), 500

def open_browser():
    webbrowser.open_new("http://127.0.0.1:5000/index.html")

if __name__ == '__main__':
    Timer(1.5, open_browser).start()
    app.run(debug=False, port=5000)
