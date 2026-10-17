"""Disposable integrated service for browser tests, with synthetic storage only."""
from pathlib import Path
import os
import sys
import tempfile
import threading
from unittest.mock import patch
from werkzeug.serving import make_server

with tempfile.TemporaryDirectory(prefix='hmi-community-browser-') as tmp:
    os.environ['LANDSCAPE_DB']=str(Path(tmp)/'recipes.db')
    os.environ['LANDSCAPE_UPLOAD_DIR']=str(Path(tmp)/'uploads')
    os.environ['AI_MODE']='demo'
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'))
    import ai_service
    with patch.object(ai_service,'dotenv_values',return_value={}):
        import app
    server=make_server('127.0.0.1',0,app.app)
    def stop():
        sys.stdin.readline()
        server.shutdown()
    threading.Thread(target=stop,daemon=True).start()
    print('READY http://127.0.0.1:'+str(server.server_port),flush=True)
    server.serve_forever()
