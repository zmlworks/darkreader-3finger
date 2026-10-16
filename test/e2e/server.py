import http.server, json, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length", 0)); d = self.rfile.read(n).decode()
        with open("/tmp/dr3f-e2e.log", "a") as f: f.write(d + "\n")
        print(d, flush=True); self.send_response(204); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
