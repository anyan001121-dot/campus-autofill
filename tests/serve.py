# 回归测试用的本地服务：在插件根目录提供文件（测试页要读 ../fill-engine.js 和 ../manifest.json）
# 用法：python3 tests/serve.py  然后打开 http://127.0.0.1:8765/tests/
#      端口被占用时：python3 tests/serve.py 8766
import http.server, os, sys
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
