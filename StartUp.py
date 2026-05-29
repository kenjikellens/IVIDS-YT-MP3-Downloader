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

# Global flags and references to manage the single-user active download process
active_process = None
cancelled = False
download_lock = threading.Lock()

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

    def __init__(self, url, output_dir, audio_format, quality, start_idx, end_idx, sse_callback):
        """
        Initializes a download manager task.
        
        :param url: The YouTube URL
        :param output_dir: Directory where tracks should be saved
        :param audio_format: Target audio compression extension (mp3/m4a/wav)
        :param quality: Output bitrate (320k/192k/128k)
        :param start_idx: Playlist start item sequence number (1-based)
        :param end_idx: Playlist end item sequence number (-1 for all)
        :param sse_callback: Function to emit log, progress, status changes as SSE
        """
        self.url = url
        self.output_dir = output_dir
        self.audio_format = audio_format
        self.quality = quality
        self.start_idx = start_idx
        self.end_idx = end_idx
        self.sse_callback = sse_callback

    def run(self):
        """
        Runs the full download task: resolves executables, gets tracks metadata,
        and triggers sequential track downloads.
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
            self.sse_callback("log", "Fetching metadata from YouTube...")
            tracks = self.fetch_track_list(yt_dlp_path)

            if cancelled:
                self.sse_callback("complete", {"success": False, "errorMsg": None})
                return

            if not tracks:
                raise Exception("Could not find any videos or metadata for the provided URL.")

            total_tracks = len(tracks)
            self.sse_callback("log", f"Found {total_tracks} video(s) in source link.")

            # Filter start and end limits
            actual_start = max(1, self.start_idx)
            actual_end = total_tracks if (self.end_idx == -1 or self.end_idx > total_tracks) else self.end_idx

            if actual_start > total_tracks:
                raise Exception(f"Start range index ({actual_start}) exceeds playlist size ({total_tracks}).")

            download_queue = tracks[actual_start - 1:actual_end]
            queue_size = len(download_queue)
            self.sse_callback("log", f"Starting download queue of {queue_size} tracks.")

            # 4. Download each track in queue
            completed = 0
            for i, track in enumerate(download_queue):
                if cancelled:
                    break

                track_num = actual_start + i
                self.sse_callback("status", {"status": f"Downloading track {i + 1} of {queue_size}", "track": track["title"]})
                self.sse_callback("log", f"Downloading [{track_num}/{total_tracks}]: {track['title']}")

                try:
                    self.execute_track_download(yt_dlp_path, ffmpeg_path, track, i, queue_size)
                    completed += 1
                    self.sse_callback("progress", int((completed / queue_size) * 100))
                except Exception as err:
                    if cancelled:
                        break
                    self.sse_callback("log", f"[Warning] Track failed: {track['title']}. Reason: {str(err)}")

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
        Locates yt-dlp.exe. Checks locally, in the system path, and downloads if missing.
        
        :return: Path to yt-dlp executable
        """
        local_path = os.path.join(base_dir, "yt-dlp.exe")
        if os.path.exists(local_path):
            return local_path

        # Check system PATH
        if self.is_command_available(["yt-dlp", "--version"]):
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
        :return: List of dicts containing track 'title' and 'id'
        """
        global active_process
        cmd = [yt_dlp_path, "--flat-playlist", "--dump-json", self.url]
        
        startupinfo = None
        if sys.platform == 'win32':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, 
                                text=True, encoding='utf-8', startupinfo=startupinfo)
        active_process = proc
        
        tracks = []
        # Parse flat JSON outputs line by line
        for line in proc.stdout:
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                if "id" in data and "title" in data:
                    tracks.append({"title": data["title"], "id": data["id"]})
            except:
                pass
                
        proc.wait()
        active_process = None
        
        # Fallback for single video files
        if not tracks:
            cmd_single = [yt_dlp_path, "--dump-json", "--playlist-items", "1", self.url]
            proc_single = subprocess.Popen(cmd_single, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, encoding='utf-8', startupinfo=startupinfo)
            active_process = proc_single
            stdout, _ = proc_single.communicate()
            active_process = None
            
            if stdout.strip():
                try:
                    data = json.loads(stdout)
                    if "id" in data and "title" in data:
                        tracks.append({"title": data["title"], "id": data["id"]})
                except:
                    pass
                    
        return tracks

    def execute_track_download(self, yt_dlp_path, ffmpeg_path, track, track_idx, total_items):
        """
        Downloads a single track. Parses download rates and updates global progress.
        
        :param yt_dlp_path: Executable path for yt-dlp
        :param ffmpeg_path: Executable path for ffmpeg
        :param track: Dict containing title and id
        :param track_idx: Download offset sequence number in the current queue (0-based)
        :param total_items: Total length of download queue
        """
        global active_process
        video_url = f"https://www.youtube.com/watch?v={track['id']}"
        output_template = os.path.join(self.output_dir, "%(title)s.%(ext)s")
        
        cmd = [
            yt_dlp_path,
            "--extract-audio",
            "--audio-format", self.audio_format,
            "--audio-quality", self.quality,
            "--ffmpeg-location", ffmpeg_path,
            "-o", output_template,
            video_url
        ]
        
        startupinfo = None
        if sys.platform == 'win32':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, 
                                text=True, encoding='utf-8', startupinfo=startupinfo)
        active_process = proc
        
        # Regex is not needed for simple percentage parsing in stdout lines
        for line in proc.stdout:
            line_str = line.strip()
            if "[download]" in line_str and "%" in line_str:
                try:
                    # Find percentage value
                    parts = line_str.split()
                    for p in parts:
                        if "%" in p:
                            pct_val = float(p.replace("%", ""))
                            # Compute overall status indicator progress
                            overall = ((track_idx * 100) + pct_val) / total_items
                            self.sse_callback("progress", int(overall))
                            break
                except:
                    pass
            if line_str.startswith("[download]") or line_str.startswith("[ffmpeg]"):
                self.sse_callback("log", line_str)
                
        for line in proc.stderr:
            err_line = line.strip()
            if err_line:
                self.sse_callback("log", err_line)
                
        proc.wait()
        active_process = None
        
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
        else:
            # Fallback to serving index.html or other static files in ui/
            if path == "/" or path == "":
                self.path = "/ui/index.html"
            else:
                self.path = "/ui" + path
            super().do_GET()

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
        global cancelled, active_process
        cancelled = True
        if active_process:
            try:
                active_process.terminate()
            except:
                pass
                
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "cancelled"}).encode('utf-8'))

    def handle_download_stream(self, query_string):
        """
        GET /api/download?...
        Initializes Server-Sent Events (SSE) stream. Blocks handler and triggers download threads.
        """
        global cancelled, active_process
        params = urllib.parse.parse_qs(query_string)
        
        url = params.get("url", [""])[0]
        output_dir = params.get("outputDir", [""])[0]
        audio_format = params.get("format", ["mp3"])[0]
        quality = params.get("quality", ["192k"])[0]
        
        try:
            start_idx = int(params.get("startIdx", ["1"])[0])
            end_idx = int(params.get("endIdx", ["-1"])[0])
        except:
            start_idx = 1
            end_idx = -1

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
            manager = DownloadManager(url, output_dir, audio_format, quality, start_idx, end_idx, emit_sse)
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
