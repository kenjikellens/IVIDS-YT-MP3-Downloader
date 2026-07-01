import os
import sys
import json
import urllib.request
import urllib.parse
import zipfile
import subprocess
import threading
import webbrowser
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import hashlib
import shutil
import time
import gemini
import gemini2
import gemini3
import shazam

log_clients = []

# Global flags and references to manage the single-user active download process
active_processes = set()
cancelled = False
download_lock = threading.Lock()

def add_log(msg):
    global log_clients
    print(msg)
    payload = f"data: {msg}\n\n"
    for client in list(log_clients):
        try:
            client.write(payload.encode('utf-8'))
            client.flush()
        except:
            if client in log_clients:
                log_clients.remove(client)



def scan_folder(source_dir):
    files_to_process = []
    allowed_extensions = ('.mp3', '.wav', '.m4a', '.flac', '.wma', '.ogg', '.aac', '.ape', '.alac')
    
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in allowed_extensions:
                full_path = os.path.join(root, file)
                file_id = hashlib.md5(full_path.encode('utf-8')).hexdigest()
                
                folder_name = os.path.basename(root)
                tags = {}
                
                if ext == '.mp3':
                    try:
                        from mutagen.easyid3 import EasyID3
                        try:
                            audio = EasyID3(full_path)
                            tags = {
                                "title": audio.get("title", [""])[0],
                                "artist": audio.get("artist", [""])[0],
                                "album": audio.get("album", [""])[0],
                                "year": audio.get("date", [""])[0],
                                "track": audio.get("tracknumber", [""])[0]
                            }
                        except:
                            pass
                    except:
                        pass
                        
                files_to_process.append({
                    "id": file_id,
                    "filename": file,
                    "full_path": full_path,
                    "folder_name": folder_name,
                    "tags": tags
                })
    return files_to_process

YEAR_CATEGORIES = [
    { "cat": "40's", "min": 1940, "max": 1949 },
    { "cat": "50's", "min": 1950, "max": 1959 },
    { "cat": "60's", "min": 1960, "max": 1969 },
    { "cat": "70's", "min": 1970, "max": 1979 },
    { "cat": "80's", "min": 1980, "max": 1989 },
    { "cat": "90's", "min": 1990, "max": 1999 },
    { "cat": "2000-2005", "min": 2000, "max": 2005 },
    { "cat": "2006-2010", "min": 2006, "max": 2010 },
    { "cat": "2011-2015", "min": 2011, "max": 2015 },
    { "cat": "2016-2020", "min": 2016, "max": 2020 },
    { "cat": "2021-2025", "min": 2021, "max": 2025 },
    { "cat": "2026-2030", "min": 2026, "max": 2030 }
]

def get_year_category(year):
    try:
        y = int(year)
        for group in YEAR_CATEGORIES:
            if y >= group["min"] and y <= group["max"]:
                return group["cat"]
    except:
        pass
    return "onbekend"

def clean_filename(name):
    if not name:
        return "Onbekend"
    return "".join(c for c in name if c not in '<>:"/\\|?*').strip()

def finalize_file(file_info, ai_data, target_dir, organize_mode="classic_periods", delete_source=False):
    """
    Finalizes the processing of a media file by determining its output path based on the selected 
    organization mode, copying or moving the file, and updating ID3 tags if it's an MP3.

    :param file_info: Dictionary containing 'full_path', 'filename', and 'folder_name'.
    :param ai_data: Dictionary containing metadata returned by Gemini/Shazam or custom fields.
    :param target_dir: Base directory where organized files should be placed.
    :param organize_mode: Sorter pattern template ('classic_periods', 'artist_album', 'channel', 'flat').
    :param delete_source: If True, the original source file is deleted after copying.
    """
    source_path = file_info.get("full_path")
    if not os.path.exists(source_path):
        raise Exception(f"Bronbestand bestaat niet: {source_path}")
        
    dest_dirs = []
    new_filename = ""
    ext = os.path.splitext(source_path)[1]
    
    # Resolve metadata fields
    artist = clean_filename(ai_data.get("artiesten") or ai_data.get("artiest(en)") or ai_data.get("artiest") or "Onbekend")
    title = clean_filename(ai_data.get("titel") or "Onbekend")
    album = clean_filename(ai_data.get("album") or "")
    
    if ai_data.get("unknown", False) and organize_mode != "channel":
        dest_dirs = [os.path.join(target_dir, "onbekend")]
        new_filename = file_info.get("filename")
    else:
        if organize_mode == "artist_album":
            if album:
                dest_dirs = [os.path.join(target_dir, artist, album)]
            else:
                dest_dirs = [os.path.join(target_dir, artist)]
            new_filename = f"{artist} - {title}{ext}"
            
        elif organize_mode == "channel":
            # Extract uploader/channel info from ai_data or tags
            channel = clean_filename(
                ai_data.get("channel") or 
                ai_data.get("uploader") or 
                file_info.get("tags", {}).get("artist") or 
                "Onbekend Kanaal"
            )
            dest_dirs = [os.path.join(target_dir, channel)]
            # If we resolved a clear artist and title, use it. Otherwise, keep the original name.
            if not ai_data.get("unknown", False) and (ai_data.get("artiesten") or ai_data.get("artiest(en)")):
                new_filename = f"{artist} - {title}{ext}"
            else:
                new_filename = file_info.get("filename")
                
        elif organize_mode == "flat":
            dest_dirs = [target_dir]
            if not ai_data.get("unknown", False):
                new_filename = f"{artist} - {title}{ext}"
            else:
                new_filename = file_info.get("filename")
                
        else:  # "classic_periods" (Standaard)
            year_val = ai_data.get("jaar")
            year_cat = get_year_category(year_val)
            original_folder = file_info.get("folder_name", "")
            new_filename = f"{artist} - {title}{ext}"
            dest_dirs = [os.path.join(target_dir, year_cat)]
            
            is_year_folder = any(group["cat"] == original_folder for group in YEAR_CATEGORIES) or original_folder.lower() == 'jaar'
            if original_folder and not is_year_folder:
                dest_dirs.append(os.path.join(target_dir, original_folder))
                
    final_path = ""
    copied_successfully = False
    for dest_dir in dest_dirs:
        if not os.path.exists(dest_dir):
            os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, new_filename)
        
        # Guard: do not copy if source and destination are the exact same file
        if os.path.abspath(source_path) == os.path.abspath(dest_path):
            final_path = dest_path
            copied_successfully = True
            continue
            
        shutil.copyfile(source_path, dest_path)
        final_path = dest_path
        copied_successfully = True
        
        # Write tags if MP3 and not unknown
        ext_lower = os.path.splitext(dest_path)[1].lower()
        if ext_lower == '.mp3' and not ai_data.get("unknown", False):
            try:
                from mutagen.easyid3 import EasyID3
                try:
                    audio = EasyID3(dest_path)
                except:
                    from mutagen.mp3 import MP3
                    audio = MP3(dest_path)
                    audio.add_tags()
                    audio = EasyID3(dest_path)
                    
                audio["title"] = ai_data.get("titel", "")
                audio["artist"] = ai_data.get("artiesten") or ai_data.get("artiest(en)") or ""
                audio["album"] = ai_data.get("album", "")
                if ai_data.get("jaar"):
                    audio["date"] = str(ai_data.get("jaar"))
                if ai_data.get("track"):
                    audio["tracknumber"] = str(ai_data.get("track"))
                audio.save()
            except Exception as tag_err:
                add_log(f"[Warning] Failed to write ID3 tags: {str(tag_err)}")

    # Clean up source file if requested and successfully copied to destinations
    if delete_source and copied_successfully:
        # Check if the source path was not one of the final destinations
        dest_paths_abs = [os.path.abspath(os.path.join(d, new_filename)) for d in dest_dirs]
        if os.path.abspath(source_path) not in dest_paths_abs:
            try:
                os.remove(source_path)
            except Exception as remove_err:
                add_log(f"[Warning] Failed to delete source file {source_path}: {str(remove_err)}")
                


# Determine folders depending on whether running as raw python script or compiled PyInstaller EXE
if getattr(sys, 'frozen', False):
    # Directory of the actual compiled IVIDS YT MP3 Downloader.exe
    base_dir = os.path.dirname(sys.executable)
    # Temporary directory where PyInstaller extracts bundled UI assets
    resources_dir = sys._MEIPASS
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    resources_dir = base_dir

class DownloadManager:
    """
    Manages the YouTube download lifecycle: dependency checks (yt-dlp and ffmpeg),
    flat playlist query retrieval, sequential download queue running, and
    progress callback triggers.
    """

    def __init__(self, url, output_dir, media_type, subfolder, format, quality, start_idx, end_idx, selected_ids, sse_callback, concurrency=1):
        """
        Initializes a download manager task and its configuration parameters.
        Stores download preferences and callback emitters in the manager instance state.
        
        :param url: The YouTube URL
        :param output_dir: Directory where tracks should be saved
        :param media_type: Target media type (video/audio)
        :param subfolder: Subfolder nesting template preference (year/playlist/channel/none)
        :param format: Target output format extension
        :param quality: Target quality bitrate or height limit
        :param start_idx: Playlist start item sequence number (1-based)
        :param end_idx: Playlist end item sequence number (-1 for all)
        :param selected_ids: List of video IDs to download (takes priority over ranges)
        :param sse_callback: Function to emit log, progress, status changes as SSE
        :param concurrency: Number of tracks to download concurrently
        """
        self.url = url
        self.output_dir = output_dir
        self.media_type = media_type or "audio"
        self.subfolder = subfolder or "none"
        self.format = format
        self.quality = quality
        self.start_idx = start_idx
        self.end_idx = end_idx
        self.selected_ids = selected_ids
        self.sse_callback = sse_callback
        self.concurrency = concurrency

    def run(self):
        """
        Runs the full download task: resolves executables, gets tracks metadata,
        and triggers concurrent track downloads using a thread pool.
        """
        global cancelled
        try:
            # 1. Check/retrieve yt-dlp dependency
            yt_dlp_path = self.resolve_yt_dlp()
            if cancelled:
                self.sse_callback("complete", {"success": False, "errorMsg": None})
                return

            # 2. Check/retrieve ffmpeg dependency
            ffmpeg_path = self.resolve_ffmpeg()
            if cancelled:
                self.sse_callback("complete", {"success": False, "errorMsg": None})
                return

            # 3. Query playlist details
            self.sse_callback("status", {"status": "Querying URL...", "track": ""})
            self.sse_callback("log", "Fetching metadata details for URL...")
            tracks = self.fetch_track_list(yt_dlp_path)

            if cancelled:
                self.sse_callback("complete", {"success": False, "errorMsg": None})
                return

            if not tracks:
                raise Exception("Could not find any videos or metadata for the provided URL.")

            total_tracks = len(tracks)
            self.sse_callback("log", f"Found {total_tracks} video(s) in source link.")

            # Filter queue based on selected IDs if present
            if self.selected_ids:
                download_queue = [t for t in tracks if t["id"] in self.selected_ids]
                actual_start = 1
            else:
                actual_start = max(1, self.start_idx)
                actual_end = total_tracks if (self.end_idx == -1 or self.end_idx > total_tracks) else self.end_idx
                if actual_start > total_tracks:
                    raise Exception(f"Start range index ({actual_start}) exceeds playlist size ({total_tracks}).")
                download_queue = tracks[actual_start - 1:actual_end]

            queue_size = len(download_queue)
            self.sse_callback("log", f"Starting download queue of {queue_size} tracks.")

            # 4. Download tracks concurrently
            completed = 0
            concurrency_limit = max(1, int(self.concurrency))

            progress_lock = threading.Lock()
            progress_map = {track["id"]: 0.0 for track in download_queue}

            active_titles = set()
            active_titles_lock = threading.Lock()

            def update_progress(track_id, percent):
                with progress_lock:
                    progress_map[track_id] = percent
                    total_pct = sum(progress_map.values())
                    overall = int(total_pct / queue_size)
                    self.sse_callback("progress", min(100, overall))

            def update_simultaneous_status():
                if cancelled:
                    return
                with active_titles_lock:
                    if active_titles:
                        titles_str = ", ".join(active_titles)
                        if concurrency_limit == 1:
                            try:
                                active_index = next(idx for idx, t in enumerate(download_queue) if t["title"] in active_titles)
                                track_num = (active_index + 1) if self.selected_ids else (actual_start + active_index)
                            except StopIteration:
                                track_num = completed + 1
                            self.sse_callback("status", {"status": f"Downloading track {track_num} of {queue_size}", "track": titles_str})
                        else:
                            self.sse_callback("status", {"status": f"Downloading {len(active_titles)} tracks simultaneously", "track": titles_str})

            def download_worker(idx_and_track):
                nonlocal completed
                idx, track = idx_and_track
                if cancelled:
                    return

                track_num = (idx + 1) if self.selected_ids else (actual_start + idx)
                self.sse_callback("log", f"Downloading [{track_num}/{total_tracks}]: {track['title']}")

                with active_titles_lock:
                    active_titles.add(track["title"])
                update_simultaneous_status()

                success = False
                try:
                    def track_progress_callback(percent):
                        update_progress(track["id"], percent)
                        self.sse_callback("track-progress", {"id": track["id"], "title": track["title"], "percent": percent})

                    self.execute_track_download(yt_dlp_path, ffmpeg_path, track, idx, queue_size, progress_callback=track_progress_callback)
                    with progress_lock:
                        completed += 1
                    success = True
                except Exception as err:
                    if cancelled:
                        return
                    self.sse_callback("log", f"[Warning] Track failed: {track['title']}. Reason: {str(err)}")
                finally:
                    with active_titles_lock:
                        if track["title"] in active_titles:
                            active_titles.remove(track["title"])
                    update_simultaneous_status()
                    update_progress(track["id"], 100.0)
                    self.sse_callback("track-progress", {"id": track["id"], "title": track["title"], "percent": 100.0 if success else -1.0})

            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=concurrency_limit) as executor:
                list(executor.map(download_worker, enumerate(download_queue)))

            # Terminate and finalize
            if cancelled:
                self.sse_callback("complete", {"success": False, "errorMsg": None})
            elif completed == 0 and queue_size > 0:
                self.sse_callback("complete", {"success": False, "errorMsg": "All items in range failed to download."})
            else:
                self.sse_callback("complete", {"success": True, "errorMsg": None})

        except Exception as err:
            self.sse_callback("complete", {"success": False, "errorMsg": str(err)})

    def resolve_yt_dlp(self):
        """
        Locates and updates yt-dlp.exe. Checks locally, in the system path, and downloads if missing.
        Automatically triggers the internal update command of yt-dlp to ensure it is always
        running the latest version to maintain compatibility with YouTube changes.
        
        :return: Path to yt-dlp executable
        """
        local_path = os.path.join(base_dir, "yt-dlp.exe")
        if os.path.exists(local_path):
            self.sse_callback("status", {"status": "Setup...", "track": "Updating yt-dlp"})
            self.sse_callback("log", "Checking and updating local yt-dlp executable...")
            try:
                startupinfo = None
                if sys.platform == 'win32':
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                # Execute yt-dlp built-in update command
                proc = subprocess.run([local_path, "--update"], capture_output=True, text=True, startupinfo=startupinfo)
                if proc.returncode == 0:
                    self.sse_callback("log", "yt-dlp update check complete (latest version or updated successfully).")
                else:
                    self.sse_callback("log", f"[Warning] yt-dlp update process returned non-zero code: {proc.stderr.strip()}")
            except Exception as e:
                self.sse_callback("log", f"[Warning] Could not update local yt-dlp executable: {str(e)}")
            return local_path

        # Check system PATH
        if self.is_command_available(["yt-dlp", "--version"]):
            # Attempt to update system yt-dlp as well, silencing errors if it lacks write permission
            try:
                startupinfo = None
                if sys.platform == 'win32':
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                subprocess.run(["yt-dlp", "--update"], capture_output=True, startupinfo=startupinfo)
            except:
                pass
            return "yt-dlp"

        # Download from GitHub
        self.sse_callback("status", {"status": "Setup...", "track": "Downloading yt-dlp"})
        self.sse_callback("log", "yt-dlp.exe is missing. Downloading latest release from GitHub (~15MB)...")
        
        url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        self.download_file_with_progress(url, local_path)
        self.sse_callback("log", "Successfully downloaded yt-dlp.exe.")
        return local_path

    def resolve_ffmpeg(self):
        """
        Locates ffmpeg.exe. Checks locally, in system path, winget, and downloads zip if missing.
        
        :return: Path to ffmpeg executable
        """
        local_path = os.path.join(base_dir, "ffmpeg.exe")
        if os.path.exists(local_path):
            return local_path

        # Check system PATH
        if self.is_command_available(["ffmpeg", "-version"]):
            return "ffmpeg"

        # Check winget paths on Windows
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            winget_path = os.path.join(local_app_data, "Microsoft", "WinGet", "Links", "ffmpeg.exe")
            if os.path.exists(winget_path):
                return winget_path

        # Download from Gyan.dev
        self.sse_callback("status", {"status": "Setup...", "track": "Downloading FFmpeg"})
        self.sse_callback("log", "ffmpeg.exe is missing. Downloading from Gyan.dev (~65MB)...")
        
        url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        zip_path = local_path + ".zip"
        
        try:
            self.download_file_with_progress(url, zip_path)
            self.sse_callback("log", "Extracting ffmpeg.exe from archive...")
            
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                for member in zip_ref.namelist():
                    if member.endswith("ffmpeg.exe"):
                        # Read binary data and write out standalone file
                        with zip_ref.open(member) as source_file, open(local_path, "wb") as target_file:
                            target_file.write(source_file.read())
                        break
            
            self.sse_callback("log", "Successfully extracted ffmpeg.exe.")
        finally:
            if os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                except:
                    pass
                    
        return local_path

    def is_command_available(self, cmd_args):
        """
        Tests whether a system command execution triggers successfully.
        
        :param cmd_args: List of command-line arguments to execute
        :return: True if command runs without error, False otherwise
        """
        try:
            subprocess.run(cmd_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return True
        except:
            return False

    def download_file_with_progress(self, file_url, dest_path):
        """
        Downloads a file and feeds download percentage reports back via SSE.
        
        :param file_url: Link to download from
        :param dest_path: Output file save location
        """
        req = urllib.request.Request(file_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response, open(dest_path, "wb") as out_file:
            total_size = int(response.info().get('Content-Length', 0))
            downloaded = 0
            block_size = 8192
            
            while True:
                if cancelled:
                    break
                buffer = response.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                out_file.write(buffer)
                if total_size > 0:
                    percent = int((downloaded / total_size) * 100)
                    self.sse_callback("progress", percent)

    def fetch_track_list(self, yt_dlp_path):
        """
        Queries playlist videos metadata flat list. Falls back to single format query.
        
        :param yt_dlp_path: Executable path to yt-dlp
        :return: List of dicts containing track 'title', 'id', 'duration', and 'channel'
        """
        global active_processes
        cmd = [yt_dlp_path, "--flat-playlist", "--dump-json", self.url]
        
        startupinfo = None
        if sys.platform == 'win32':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, 
                                text=True, encoding='utf-8', errors='replace', startupinfo=startupinfo)
        active_processes.add(proc)
        
        tracks = []
        try:
            # Parse flat JSON outputs line by line
            for line in proc.stdout:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    if "id" in data and "title" in data:
                        tracks.append({
                            "title": data.get("title") or data.get("id") or "Unknown Video",
                            "id": data["id"],
                            "duration": data.get("duration"),
                            "channel": data.get("channel") or data.get("uploader") or "Unknown Channel"
                        })
                except:
                    pass
        finally:
            proc.wait()
            active_processes.discard(proc)
            
        # Fallback for single video files
        if not tracks and not cancelled:
            cmd_single = [yt_dlp_path, "--dump-json", "--playlist-items", "1", self.url]
            proc_single = subprocess.Popen(cmd_single, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, encoding='utf-8', errors='replace', startupinfo=startupinfo)
            active_processes.add(proc_single)
            try:
                stdout, _ = proc_single.communicate()
            finally:
                active_processes.discard(proc_single)
            
            if stdout.strip():
                try:
                    data = json.loads(stdout)
                    if "id" in data and "title" in data:
                        tracks.append({
                            "title": data.get("title") or data.get("id") or "Unknown Video",
                            "id": data["id"],
                            "duration": data.get("duration"),
                            "channel": data.get("channel") or data.get("uploader") or "Unknown Channel"
                        })
                except:
                    pass
                    
        return tracks

    def execute_track_download(self, yt_dlp_path, ffmpeg_path, track, track_idx, total_items, progress_callback=None):
        """
        Downloads a single track as video or audio using yt-dlp and ffmpeg.
        Parses download rates from subprocess stdout and updates global progress values.
        
        :param yt_dlp_path: Executable path for yt-dlp
        :param ffmpeg_path: Executable path for ffmpeg
        :param track: Dict containing title and id
        :param track_idx: Download offset sequence number in the current queue (0-based)
        :param total_items: Total length of download queue
        :param progress_callback: Optional callback to receive raw progress percentages
        """
        global active_processes
        video_url = f"https://www.youtube.com/watch?v={track['id']}"
        
        subfolder_path = ""
        if self.subfolder == "year":
            subfolder_path = "%(upload_date>%Y|Unknown Year)s/"
        elif self.subfolder == "playlist":
            subfolder_path = "%(playlist|Unknown Playlist)s/"
        elif self.subfolder == "channel":
            subfolder_path = "%(uploader|Unknown Channel)s/"

        output_template = os.path.join(self.output_dir, subfolder_path + "%(title)s.%(ext)s")
        
        cmd = [yt_dlp_path]
        if self.media_type == "video":
            format_str = "bestvideo+bestaudio/best"
            if self.quality != "best":
                format_str = f"bestvideo[height<={self.quality}]+bestaudio/best"
            cmd.extend(["--format", format_str])
            if self.format != "best":
                cmd.extend(["--merge-output-format", self.format])
            cmd.extend([
                "--concurrent-fragments", "5",
                "--no-playlist",
                "-o", output_template,
                video_url
            ])
        else:
            cmd.extend([
                "--extract-audio",
                "--audio-format", self.format
            ])
            if self.format != "best":
                cmd.extend(["--audio-quality", self.quality])
            cmd.extend([
                "--concurrent-fragments", "5",
                "--no-playlist",
                "-o", output_template,
                video_url
            ])
        
        if ffmpeg_path != "ffmpeg":
            cmd.extend(["--ffmpeg-location", ffmpeg_path])
        
        startupinfo = None
        if sys.platform == 'win32':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        # Combine stdout and stderr to avoid classic buffer deadlock
        self.sse_callback("log", f"Executing yt-dlp with arguments: {cmd}")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, 
                                text=True, encoding='utf-8', errors='replace', startupinfo=startupinfo)
        active_processes.add(proc)
        
        try:
            # Read lines from the combined stream
            for line in proc.stdout:
                line_str = line.strip()
                if not line_str:
                    continue
                    
                if "[download]" in line_str and "%" in line_str:
                    try:
                        parts = line_str.split()
                        for p in parts:
                            if "%" in p:
                                pct_val = float(p.replace("%", ""))
                                if progress_callback:
                                    progress_callback(pct_val)
                                else:
                                    overall = ((track_idx * 100) + pct_val) / total_items
                                    self.sse_callback("progress", int(overall))
                                break
                    except:
                        pass
                        
                if (line_str.startswith("[download]") or 
                    line_str.startswith("[ffmpeg]") or 
                    "error" in line_str.lower() or 
                    "warning" in line_str.lower()):
                    self.sse_callback("log", line_str)
        finally:
            proc.wait()
            active_processes.discard(proc)
        
        if proc.returncode != 0 and not cancelled:
            raise Exception(f"yt-dlp exited with error code {proc.returncode}")


class PythonWebServerHandler(SimpleHTTPRequestHandler):
    """
    Standard HTTP Request Handler representing routes serving assets
    and executing directory pickers or download SSE streams.
    """

    def end_headers(self):
        """
        Appends anti-caching headers to all HTTP responses to prevent browser file caching.
        """
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        """
        Handles incoming GET requests. Route mapper.
        """
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # REST API endpoints mapping
        if path == "/api/get-default-dir":
            self.handle_get_default_dir()
        elif path == "/api/select-directory":
            self.handle_select_directory()
        elif path == "/api/download":
            self.handle_download_stream(parsed_url.query)
        elif path == "/api/cancel":
            self.handle_cancel_download()
        elif path == "/api/fetch-metadata":
            self.handle_fetch_metadata(parsed_url.query)
        elif path == "/api/get_file":
            self.handle_get_file(parsed_url.query)
        elif path == "/api/log_stream":
            self.handle_log_stream()
        else:
            # Fallback to serving index.html or other static files in ui/
            if path == "/" or path == "":
                self.path = "/ui/index.html"
            elif not path.startswith("/ui/"):
                self.path = "/ui" + path
            super().do_GET()

    def do_POST(self):
        """
        Handles incoming POST requests. Route mapper.
        """
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        if path == "/api/scan":
            self.handle_scan(post_data)
        elif path == "/api/finalize":
            self.handle_finalize(post_data)
        elif path == "/api/gemini":
            self.handle_gemini(post_data)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_get_file(self, query_string):
        params = urllib.parse.parse_qs(query_string)
        file_path = params.get("path", [""])[0]
        
        if not file_path or not os.path.exists(file_path):
            self.send_response(404)
            self.end_headers()
            return
            
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        with open(file_path, 'rb') as f:
            self.wfile.write(f.read())

    def handle_log_stream(self):
        global log_clients
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        log_clients.append(self.wfile)
        try:
            while True:
                time.sleep(5)
                self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except:
            pass
        finally:
            if self.wfile in log_clients:
                log_clients.remove(self.wfile)

    def handle_scan(self, post_data):
        try:
            params = json.loads(post_data.decode('utf-8'))
            source_dir = params.get("source_dir")
            if not source_dir:
                raise Exception("Missing source_dir parameter")
            files = scan_folder(source_dir)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"files": files}).encode('utf-8'))
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

    def handle_finalize(self, post_data):
        """
        Handles POST /api/finalize requests.
        Parses the JSON request body containing file_info, ai_data, target_dir, 
        organize_mode, and delete_source, then calls finalize_file.
        """
        try:
            params = json.loads(post_data.decode('utf-8'))
            file_info = params.get("file_info")
            ai_data = params.get("ai_data")
            target_dir = params.get("target_dir")
            organize_mode = params.get("organize_mode", "classic_periods")
            delete_source = params.get("delete_source", False)
            
            finalize_file(file_info, ai_data, target_dir, organize_mode=organize_mode, delete_source=delete_source)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "Succes", "result": "Verwerkt"}).encode('utf-8'))
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

    def handle_gemini(self, post_data):
        try:
            params = json.loads(post_data.decode('utf-8'))
            module_name = params.get("module")
            filename = params.get("filename")
            folder_name = params.get("folder_name")
            tags = params.get("tags")
            
            if module_name == "gemini":
                result, err = gemini.ask_ai(filename, folder_name, tags)
            elif module_name == "gemini2":
                result, err = gemini2.ask_ai(filename, folder_name, tags)
            elif module_name == "gemini3":
                result, err = gemini3.ask_ai(filename, folder_name, tags)
            elif module_name == "shazam":
                result, err = shazam.ask_shazam(params.get("filepath", ""))
            else:
                raise Exception(f"Unknown gemini module: {module_name}")
                
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"result": result, "error": err}).encode('utf-8'))
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))


    def handle_get_default_dir(self):
        """
        GET /api/get-default-dir
        Returns the user's default operating system Downloads directory path.
        """
        downloads_dir = ""
        if sys.platform == "win32":
            downloads_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Downloads")
        else:
            downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
            
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"path": downloads_dir}).encode('utf-8'))

    def handle_select_directory(self):
        """
        GET /api/select-directory
        Launches standard tkinter directory selection dialog window.
        """
        path = ""
        try:
            import tkinter as tk
            from tkinter import filedialog
            
            # Hide main tkinter helper window
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            
            path = filedialog.askdirectory(title="Select Download Folder")
            root.destroy()
        except Exception as e:
            # tkinter may not be available on headless installations
            pass

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"path": path if path else None}).encode('utf-8'))

    def handle_cancel_download(self):
        """
        GET /api/cancel
        Sends termination signals to active download task processes.
        """
        global cancelled, active_processes
        cancelled = True
        for proc in list(active_processes):
            try:
                proc.terminate()
            except:
                pass
        active_processes.clear()
                
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "cancelled"}).encode('utf-8'))

    def handle_fetch_metadata(self, query_string):
        """
        Handles incoming REST API requests to query track metadata.
        Resolves yt-dlp, fetches playlist/video JSON info, and returns a JSON payload.
        """
        params = urllib.parse.parse_qs(query_string)
        url = params.get("url", [""])[0]
        
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        if not url:
            self.wfile.write(json.dumps({"error": "Missing URL parameter"}).encode('utf-8'))
            return
            
        try:
            # dummy callback since we just query details
            def dummy_callback(event, data):
                pass
            manager = DownloadManager(url, "", "audio", "none", "mp3", "192k", 1, -1, None, dummy_callback)
            yt_dlp_path = manager.resolve_yt_dlp()
            tracks = manager.fetch_track_list(yt_dlp_path)
            self.wfile.write(json.dumps({"tracks": tracks}).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

    def handle_download_stream(self, query_string):
        """
        Initializes a Server-Sent Events (SSE) stream for download progress.
        Parses query parameters, instantiates a DownloadManager, and triggers the download sequence.
        """
        global cancelled, active_processes
        params = urllib.parse.parse_qs(query_string)
        
        url = params.get("url", [""])[0]
        output_dir = params.get("outputDir", [""])[0]
        media_type = params.get("mediaType", ["audio"])[0]
        subfolder = params.get("subfolder", ["none"])[0]
        format = params.get("format", ["mp3"])[0]
        quality = params.get("quality", ["192k"])[0]
        
        try:
            start_idx = int(params.get("startIdx", ["1"])[0])
            end_idx = int(params.get("endIdx", ["-1"])[0])
        except:
            start_idx = 1
            end_idx = -1

        try:
            concurrency = int(params.get("concurrency", ["1"])[0])
        except:
            concurrency = 1
            
        selected_ids = params.get("selectedIds", [])
        if len(selected_ids) == 1 and "," in selected_ids[0]:
            selected_ids = selected_ids[0].split(",")
            
        # Setup chunked SSE header
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        # Define SSE package transmitter
        def emit_sse(event, data):
            try:
                payload = f"event: {event}\ndata: {json.dumps(data)}\n\n"
                self.wfile.write(payload.encode('utf-8'))
                self.wfile.flush()
            except:
                # Triggers if browser cancels connections or shuts down tabs
                pass
                
        # Use mutex lock to prevent concurrent download schedules on the same server
        acquired = download_lock.acquire(blocking=False)
        if not acquired:
            emit_sse("complete", {"success": False, "errorMsg": "Another download job is currently running on the server."})
            return
            
        try:
            cancelled = False
            manager = DownloadManager(url, output_dir, media_type, subfolder, format, quality, start_idx, end_idx, selected_ids, emit_sse, concurrency)
            manager.run()
        finally:
            download_lock.release()


def find_free_port(start_port=8080):
    """
    Finds a free port beginning from a start offset to bind the server.
    
    :param start_port: Initial port check offset
    :return: Free available port integer
    """
    port = start_port
    while port < 65535:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("localhost", port))
                return port
            except socket.error:
                port += 1
    return start_port


def main():
    """
    Entry point. Initializes and runs the local Python web server.
    """
    # Force working directory mapping to resources folder location (e.g. unpacked folder in PyInstaller)
    os.chdir(resources_dir)

    port = find_free_port(8080)
    server_address = ("localhost", port)

    print(f"Starting IVIDS YT MP3 Downloader Server on http://localhost:{port} ...")
    
    # Run the server in a separate thread so browser can open in parallel
    server = ThreadingHTTPServer(server_address, PythonWebServerHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # Launch local browser tab
    try:
        webbrowser.open(f"http://localhost:{port}")
    except Exception as e:
        print(f"Failed to open default web browser automatically: {e}")

    print("Server is running. Press Ctrl+C to shut down.")
    try:
        while True:
            server_thread.join(timeout=1)
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()
        sys.exit(0)

if __name__ == "__main__":
    main()
