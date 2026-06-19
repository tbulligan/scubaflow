import http.server
import socketserver
import json
import os
import sys
import tempfile
import subprocess
import shutil

PORT = 8000

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/log':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                log_data = json.loads(post_data.decode('utf-8'))
                log_type = log_data.get('type', 'log')
                message = log_data.get('message', '')
                
                # Print to stdout so it shows in the background task logs
                print(f"[{log_type.upper()}] {message}", flush=True)
                
                # Write to browser_logs.txt
                with open('browser_logs.txt', 'a', encoding='utf-8') as f:
                    f.write(f"[{log_type.upper()}] {message}\n")
                
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b"OK")
            except Exception as e:
                print(f"Error handling /log: {e}", file=sys.stderr, flush=True)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path == '/yt-audio':
            # YouTube audio proxy via yt-dlp.
            # For personal/local use only — respect YouTube's Terms of Service.
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8'))
                yt_url = body.get('url', '').strip()
                if not yt_url:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Missing 'url' field")
                    return

                # Check yt-dlp is available
                ytdlp_bin = shutil.which('yt-dlp')
                if not ytdlp_bin:
                    self.send_response(503)
                    self.end_headers()
                    self.wfile.write(b"yt-dlp not found. Install with: pip install yt-dlp")
                    return

                print(f"[YT] Downloading audio from: {yt_url}", flush=True)
                tmpdir = tempfile.mkdtemp()
                out_template = os.path.join(tmpdir, 'audio.%(ext)s')

                cmd = [
                    ytdlp_bin,
                    '--no-playlist',
                    '-x',                        # extract audio
                    '--audio-format', 'mp3',     # always output mp3
                    '--audio-quality', '5',      # 128kbps — enough for analysis
                    '-o', out_template,
                    yt_url
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    err_msg = result.stderr[-800:] if result.stderr else 'Unknown error'
                    print(f"[YT] yt-dlp failed: {err_msg}", flush=True)
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(f"yt-dlp error: {err_msg}".encode())
                    shutil.rmtree(tmpdir, ignore_errors=True)
                    return

                # Find the output file
                out_files = [f for f in os.listdir(tmpdir) if f.startswith('audio.')]
                if not out_files:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(b"yt-dlp produced no output file")
                    shutil.rmtree(tmpdir, ignore_errors=True)
                    return

                audio_path = os.path.join(tmpdir, out_files[0])
                with open(audio_path, 'rb') as f:
                    audio_data = f.read()

                shutil.rmtree(tmpdir, ignore_errors=True)
                print(f"[YT] Serving {len(audio_data)} bytes of audio", flush=True)

                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(len(audio_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(audio_data)

            except subprocess.TimeoutExpired:
                self.send_response(504)
                self.end_headers()
                self.wfile.write(b"yt-dlp timed out after 120s")
            except Exception as e:
                print(f"Error handling /yt-audio: {e}", file=sys.stderr, flush=True)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def run():
    # Clear old browser logs on start
    if os.path.exists('browser_logs.txt'):
        try:
            os.remove('browser_logs.txt')
        except Exception as e:
            print(f"Could not remove browser_logs.txt: {e}")
            
    handler = CustomHTTPRequestHandler
    # Allow address reuse to restart the server quickly
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"Custom HTTP Server running at port {PORT} with /log and /yt-audio capability")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == '__main__':
    run()
