# Implementation Plan: Workflow Customisation (Folders & Formats)

Dit plan beschrijft de uitbreiding van de **Workflow Pipeline** en de **Music Organiser** om gebruikers in staat te stellen de mappenstructuur en bestandsafhandeling volledig te customizen (bijv. sorteren per jaar, per album, per kanaal/YouTuber, of via het klassieke tijdvakken-sjabloon). Ook voegen we volledige ondersteuning toe voor video's.

---

## 🛠️ Voorgestelde Wijzigingen

### 1. Backend Uitbreiding (`StartUp.py` & Sorter)
*   **Ondersteuning voor Custom Sorteer-templates**:
    *   Het backend sorteeralgoritme (in `StartUp.py` of de finalizer) moet dynamisch mappen kunnen genereren op basis van de gekozen template.
    *   **Klassiek Tijdvakken-sjabloon (MOET BEHOUDEN WORDEN)**: De originele structuur (bijv. `2011-2015`, `2016-2020`) blijft de standaardoptie (`classic_periods`).
    *   **Per Jaar (`year`)**: Maakt submappen aan op basis van het releasejaar van de track/video (bijv. `/2024/`).
    *   **Per Artiest / Album (`artist_album`)**: Maakt submappen aan op basis van de artiestennaam en daaronder het album (bijv. `/Artiest/Album/`).
    *   **Per Kanaal / YouTuber (`channel`)**: Ideaal voor video's of YouTube rips; maakt submappen aan op basis van de kanaalnaam (bijv. `/Kanaalnaam/`).
*   **Video-vriendelijke Sortering**:
    *   Bij video-downloads of videobestanden negeren we Shazam audio-matching (aangezien Shazam alleen audio identificeert) en vertrouwen we primair op Gemini AI om de YouTuber/kanaalnaam te matchen en te categoriseren.

### 2. UI Uitbreiding (`pipeline.html` & `organiser.html`)
*   **Workflow Folder Customiser Sectie**:
    *   We voegen een duidelijke dropdown of template-builder toe onder "Stap 3: AI Sortering & Organisatie".
    *   Opties in de dropdown:
        1.  `Muziek - Klassieke Tijdvakken (2011-2015, enz.)` -> Behaalt de originele structuur.
        2.  `Jaar - Sorteren per uitgavejaar (bijv. /2023/)`
        3.  `Muziek - Sorteren op Artiest / Album`
        4.  `Video - Sorteren op YouTube Kanaal / YouTuber`
        5.  `Plat - Alles in één map zonder submappen`
*   **Video-ondersteuning in de Pipeline**:
    *   Wanneer de gebruiker kiest voor `Video` als Media Type in Stap 2, past de UI automatisch de sorteer-optie aan naar `Sorteren op YouTube Kanaal / YouTuber` als logische standaard.

---

## 🔍 Verificatieplan

1.  **Unit Tests / Handmatige checks**:
    *   Testen van de backend sorteerfunctie met testbestanden voor elk van de 5 sorteersjablonen.
    *   Verifiëren dat de originele periodenstructuur (`2011-2015`) nog exact zo werkt als voorheen.
2.  **UI Validatie**:
    *   Visueel testen van de dropdowns en controleren of video-opties correct worden doorgegeven aan de finalizer op de backend.
