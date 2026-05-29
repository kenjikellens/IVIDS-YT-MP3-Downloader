/**
 * downloadManager.js — Download Manager (Node.js Backend)
 * 
 * Handles all background tasks: verifying/downloading yt-dlp and ffmpeg,
 * querying playlist metadata JSON streams, and executing sequential track
 * download processes. Runs inside the Electron main process.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createWriteStream } = require('fs');

class DownloadManager {
    /**
     * Creates a new DownloadManager instance.
     * 
     * @param {Object} options     Download configuration parameters from UI
     * @param {string} options.url       YouTube URL link
     * @param {string} options.outputDir Output save folder path
     * @param {string} options.format    Audio format compression (mp3/m4a/wav)
     * @param {string} options.quality   Audio quality bitrate (320k/192k/128k)
     * @param {number} options.startIdx  Playlist start index (1-based)
     * @param {number} options.endIdx    Playlist end index (-1 means all)
     * @param {Object} listener    Callback methods containing onLog, onProgress, onStatusChange, onComplete
     */
    constructor(options, listener) {
        this.url = options.url;
        this.outputDir = options.outputDir;
        this.format = options.format;
        this.quality = options.quality;
        this.startIdx = options.startIdx;
        this.endIdx = options.endIdx;
        this.selectedIds = options.selectedIds || null;
        this.concurrency = options.concurrency || 1;
        this.listener = listener;

        this.cancelled = false;
        this.activeProcesses = new Set();
        this.progressMap = {};
    }

    /**
     * Aborts download queues: flips cancellation flag and kills running subprocesses.
     */
    cancel() {
        this.cancelled = true;
        this.activeProcesses.forEach(proc => {
            try {
                proc.kill('SIGINT');
            } catch (e) {}
        });
        this.activeProcesses.clear();
    }

    /**
     * Executes the download thread pipeline: resolves dependencies, fetches
     * metadata list, and schedules track downloads sequentially.
     */
    async run() {
        try {
            // 1. Check and download yt-dlp
            const ytDlpPath = await this.resolveYtDlp();
            if (this.cancelled) { this.listener.onComplete(false, null); return; }

            // 2. Check and download ffmpeg
            const ffmpegPath = await this.resolveFfmpeg();
            if (this.cancelled) { this.listener.onComplete(false, null); return; }

            // 3. Query details
            this.listener.onStatusChange('Querying URL...', '');
            this.listener.onLog('Fetching metadata from YouTube...');
            const tracks = await this.fetchTrackList(ytDlpPath);

            if (this.cancelled) { this.listener.onComplete(false, null); return; }

            if (tracks.length === 0) {
                throw new Error('Could not find any videos or metadata for the provided URL.');
            }

            const totalTracks = tracks.length;
            this.listener.onLog(`Found ${totalTracks} video(s) in source link.`);

            let downloadQueue = [];
            if (this.selectedIds && this.selectedIds.length > 0) {
                downloadQueue = tracks.filter(t => this.selectedIds.includes(t.id));
            } else {
                const actualStart = Math.max(1, this.startIdx);
                const actualEnd = (this.endIdx === -1 || this.endIdx > totalTracks)
                    ? totalTracks : this.endIdx;
                if (actualStart > totalTracks) {
                    throw new Error(`Start range index (${actualStart}) exceeds playlist size (${totalTracks}).`);
                }
                downloadQueue = tracks.slice(actualStart - 1, actualEnd);
            }
            const queueSize = downloadQueue.length;
            this.listener.onLog(`Starting download queue of ${queueSize} tracks.`);

            // 4. Run downloads concurrently using worker pool
            let completed = 0;
            this.progressMap = {};
            downloadQueue.forEach(t => {
                this.progressMap[t.id] = 0;
            });

            const actualStart = (this.selectedIds && this.selectedIds.length > 0) ? 1 : Math.max(1, this.startIdx);
            const concurrencyLimit = Math.max(1, parseInt(this.concurrency) || 1);
            let nextIndex = 0;
            const activeTitles = new Set();
            const self = this;

            /**
             * Updates the active status text showing the current simultaneous downloading tracks.
             */
            function updateSimultaneousStatus() {
                if (self.cancelled) return;
                if (activeTitles.size > 0) {
                    const titlesStr = Array.from(activeTitles).join(', ');
                    if (concurrencyLimit === 1) {
                        const activeIndex = downloadQueue.findIndex(t => activeTitles.has(t.title));
                        const trackNumber = activeIndex !== -1 ? (actualStart + activeIndex) : (completed + 1);
                        self.listener.onStatusChange(`Downloading track ${trackNumber} of ${queueSize}`, titlesStr);
                    } else {
                        self.listener.onStatusChange(`Downloading ${activeTitles.size} tracks simultaneously`, titlesStr);
                    }
                }
            }

            /**
             * Asynchronous worker function that retrieves tracks from the queue and downloads them.
             */
            async function worker() {
                while (nextIndex < queueSize && !self.cancelled) {
                    const i = nextIndex++;
                    const track = downloadQueue[i];
                    const trackNum = (self.selectedIds && self.selectedIds.length > 0) ? (i + 1) : (actualStart + i);

                    self.listener.onLog(`Downloading [${trackNum}/${totalTracks}]: ${track.title}`);

                    try {
                        activeTitles.add(track.title);
                        updateSimultaneousStatus();
                        await self.executeTrackDownload(ytDlpPath, ffmpegPath, track, i, queueSize);
                        completed++;
                    } catch (err) {
                        if (self.cancelled) break;
                        self.listener.onLog(`[Warning] Track failed: ${track.title}. Reason: ${err.message}`);
                    } finally {
                        activeTitles.delete(track.title);
                        updateSimultaneousStatus();
                    }
                }
            }

            const workers = [];
            const activeWorkersCount = Math.min(concurrencyLimit, queueSize);
            for (let w = 0; w < activeWorkersCount; w++) {
                workers.push(worker());
            }

            await Promise.all(workers);

            if (this.cancelled) {
                this.listener.onComplete(false, null);
            } else if (completed === 0 && queueSize > 0) {
                this.listener.onComplete(false, 'All items in range failed to download.');
            } else {
                this.listener.onComplete(true, null);
            }

        } catch (err) {
            this.listener.onComplete(false, err.message);
        }
    }

    // ================================================================
    // Dependencies resolving tasks
    // ================================================================

    /**
     * Resolves yt-dlp.exe. Checks locally, system PATH, and downloads if missing.
     * @returns {Promise<string>} Path to executable
     */
    async resolveYtDlp() {
        const localPath = path.join(process.cwd(), 'yt-dlp.exe');
        if (fs.existsSync(localPath)) return localPath;

        const inPath = await this.isCommandAvailable('yt-dlp');
        if (inPath) return 'yt-dlp';

        this.listener.onStatusChange('Setup...', 'Downloading yt-dlp');
        this.listener.onLog('yt-dlp.exe is missing. Downloading latest release from GitHub (~15MB)...');
        await this.downloadFile(
            'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
            localPath
        );
        this.listener.onLog('Successfully downloaded yt-dlp.exe.');
        return localPath;
    }

    /**
     * Resolves ffmpeg.exe. Checks locally, system PATH, winget, and downloads zip if missing.
     * @returns {Promise<string>} Path to executable
     */
    async resolveFfmpeg() {
        const localPath = path.join(process.cwd(), 'ffmpeg.exe');
        if (fs.existsSync(localPath)) return localPath;

        const inPath = await this.isCommandAvailable('ffmpeg');
        if (inPath) return 'ffmpeg';

        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            const wingetPath = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
            if (fs.existsSync(wingetPath)) return wingetPath;
        }

        this.listener.onStatusChange('Setup...', 'Downloading FFmpeg');
        this.listener.onLog('ffmpeg.exe is missing. Downloading from Gyan.dev (~65MB)...');
        await this.downloadAndExtractFfmpeg(
            'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
            localPath
        );
        this.listener.onLog('Successfully extracted ffmpeg.exe.');
        return localPath;
    }

    /**
     * Validates whether a command registers successfully in the environment path.
     * @param {string} cmd - Command string
     * @returns {Promise<boolean>} True if runnable
     */
    isCommandAvailable(cmd) {
        return new Promise((resolve) => {
            execFile(cmd, ['--version'], (error) => {
                resolve(!error);
            });
        });
    }

    // ================================================================
    // Metadata querying tasks
    // ================================================================

    /**
     * Queries playlist track metadata lists. Falls back to single JSON query.
     * @param {string} ytDlpPath - Path to yt-dlp executable
     * @returns {Promise<Array>} Track list array
     */
    async fetchTrackList(ytDlpPath) {
        let tracks = await this.runFlatPlaylist(ytDlpPath, this.url);

        if (tracks.length === 0) {
            tracks = await this.runSingleDump(ytDlpPath, this.url);
        }

        return tracks;
    }

    /**
     * Runs flat playlist JSON metadata parsers.
     * @param {string} ytDlpPath - Path to yt-dlp executable
     * @param {string} sourceUrl - YouTube URL
     * @returns {Promise<Array>} Track list parsed
     */
    runFlatPlaylist(ytDlpPath, sourceUrl) {
        return new Promise((resolve, reject) => {
            const tracks = [];
            const proc = spawn(ytDlpPath, ['--flat-playlist', '--dump-json', sourceUrl]);
            this.activeProcess = proc;

            let buffer = '';

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.id && json.title) {
                            tracks.push({
                                title: json.title,
                                id: json.id,
                                duration: json.duration || null,
                                channel: json.channel || json.uploader || 'Unknown Channel'
                            });
                        }
                    } catch (e) {}
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', () => {
                this.activeProcess = null;
                if (buffer.trim()) {
                    try {
                        const json = JSON.parse(buffer);
                        if (json.id && json.title) {
                            tracks.push({
                                title: json.title,
                                id: json.id,
                                duration: json.duration || null,
                                channel: json.channel || json.uploader || 'Unknown Channel'
                            });
                        }
                    } catch (e) {}
                }
                resolve(tracks);
            });

            proc.on('error', (err) => {
                this.activeProcess = null;
                reject(err);
            });
        });
    }

    /**
     * Runs single JSON file query for video items.
     * @param {string} ytDlpPath - Path to yt-dlp executable
     * @param {string} sourceUrl - YouTube URL
     * @returns {Promise<Array>} List with single track
     */
    runSingleDump(ytDlpPath, sourceUrl) {
        return new Promise((resolve, reject) => {
            const tracks = [];
            const proc = spawn(ytDlpPath, ['--dump-json', '--playlist-items', '1', sourceUrl]);
            this.activeProcess = proc;

            let output = '';
            proc.stdout.on('data', (data) => { output += data.toString(); });
            proc.stderr.on('data', () => {});

            proc.on('close', () => {
                this.activeProcess = null;
                try {
                    const json = JSON.parse(output);
                    if (json.id && json.title) {
                        tracks.push({
                            title: json.title,
                            id: json.id,
                            duration: json.duration || null,
                            channel: json.channel || json.uploader || 'Unknown Channel'
                        });
                    }
                } catch (e) {}
                resolve(tracks);
            });

            proc.on('error', (err) => {
                this.activeProcess = null;
                reject(err);
            });
        });
    }

    // ================================================================
    // Subprocess execution tasks
    // ================================================================

    /**
     * Executes single video downloads and updates progress percentages.
     * @param {string} ytDlpPath - Path to yt-dlp executable
     * @param {string} ffmpegPath - Path to ffmpeg executable
     * @param {Object} track - Track details
     * @param {number} trackIndex - Track index
     * @param {number} totalItems - Queue length
     * @returns {Promise<void>}
     */
    executeTrackDownload(ytDlpPath, ffmpegPath, track, trackIndex, totalItems) {
        return new Promise((resolve, reject) => {
            const videoUrl = `https://www.youtube.com/watch?v=${track.id}`;
            const outputTemplate = path.join(this.outputDir, '%(title)s.%(ext)s');

            const args = [
                '--extract-audio',
                '--audio-format', this.format,
                '--audio-quality', this.quality,
                '--concurrent-fragments', '5',
                '--no-playlist',
                '-o', outputTemplate,
                videoUrl
            ];

            if (ffmpegPath !== 'ffmpeg') {
                args.push('--ffmpeg-location', ffmpegPath);
            }

            const proc = spawn(ytDlpPath, args);
            this.activeProcesses.add(proc);

            const progressRegex = /\[download\]\s+(\d+(?:\.\d+)?)%/;

            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    const match = line.match(progressRegex);
                    if (match) {
                        const trackPercent = parseFloat(match[1]);
                        this.progressMap[track.id] = trackPercent;
                        this.updateOverallProgress(totalItems);
                    }
                    if (line.startsWith('[download]') || line.startsWith('[ffmpeg]')) {
                        this.listener.onLog(line.trim());
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line) this.listener.onLog(line);
            });

            proc.on('close', (code) => {
                this.activeProcesses.delete(proc);
                if (code !== 0 && !this.cancelled) {
                    this.progressMap[track.id] = 100;
                    this.updateOverallProgress(totalItems);
                    reject(new Error(`yt-dlp exited with error code ${code}`));
                } else {
                    this.progressMap[track.id] = 100;
                    this.updateOverallProgress(totalItems);
                    resolve();
                }
            });

            proc.on('error', (err) => {
                this.activeProcesses.delete(proc);
                this.progressMap[track.id] = 100;
                this.updateOverallProgress(totalItems);
                reject(err);
            });
        });
    }

    /**
     * Calculates and reports the overall aggregated download progress percentage.
     * @param {number} totalItems - Total number of items in the queue
     */
    updateOverallProgress(totalItems) {
        if (totalItems <= 0) return;
        let sum = 0;
        for (const id in this.progressMap) {
            sum += this.progressMap[id];
        }
        const overall = sum / totalItems;
        this.listener.onProgress(Math.min(100, Math.round(overall)));
    }

    // ================================================================
    // HTTP helper methods
    // ================================================================

    /**
     * Downloads files using redirects.
     * @param {string} fileUrl - URL path
     * @param {string} destPath - Output path
     * @returns {Promise<void>}
     */
    downloadFile(fileUrl, destPath) {
        return new Promise((resolve, reject) => {
            const doRequest = (url) => {
                const protocol = url.startsWith('https') ? https : http;
                protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        doRequest(res.headers.location);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed with HTTP ${res.statusCode}`));
                        return;
                    }

                    const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                    let downloaded = 0;
                    const file = createWriteStream(destPath);

                    res.on('data', (chunk) => {
                        downloaded += chunk.length;
                        file.write(chunk);
                        if (totalBytes > 0) {
                            this.listener.onProgress(Math.round((downloaded / totalBytes) * 100));
                        }
                    });

                    res.on('end', () => {
                        file.end(() => resolve());
                    });

                    res.on('error', (err) => {
                        file.close();
                        fs.unlinkSync(destPath);
                        reject(err);
                    });
                }).on('error', reject);
            };

            doRequest(fileUrl);
        });
    }

    /**
     * Downloads and extracts ffmpeg.exe from Gyan.dev zip using PowerShell handles.
     * @param {string} zipUrl - URL path
     * @param {string} destPath - Output path
     * @returns {Promise<void>}
     */
    async downloadAndExtractFfmpeg(zipUrl, destPath) {
        const tempZip = destPath + '.zip';

        try {
            this.listener.onLog('Downloading FFmpeg archive (this may take a moment)...');
            await this.downloadFile(zipUrl, tempZip);

            this.listener.onLog('Extracting ffmpeg.exe from archive...');

            await new Promise((resolve, reject) => {
                const psScript = `
                    $zip = [System.IO.Compression.ZipFile]::OpenRead('${tempZip.replace(/'/g, "''")}');
                    $entry = $zip.Entries | Where-Object { $_.Name -eq 'ffmpeg.exe' } | Select-Object -First 1;
                    if ($entry) {
                        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${destPath.replace(/'/g, "''")}', $true);
                        $zip.Dispose();
                    } else {
                        $zip.Dispose();
                        throw 'ffmpeg.exe not found in archive';
                    }
                `;
                const proc = spawn('powershell', ['-NoProfile', '-Command', psScript]);
                this.activeProcesses.add(proc);

                let stderr = '';
                proc.stderr.on('data', (d) => { stderr += d.toString(); });
                proc.on('close', (code) => {
                    this.activeProcesses.delete(proc);
                    if (code === 0) resolve();
                    else reject(new Error(stderr || 'FFmpeg extraction failed'));
                });
                proc.on('error', (err) => {
                    this.activeProcesses.delete(proc);
                    reject(err);
                });
            });
        } finally {
            if (fs.existsSync(tempZip)) {
                try { fs.unlinkSync(tempZip); } catch (e) {}
            }
        }
    }
}

module.exports = DownloadManager;
