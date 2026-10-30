"""Disposable integrated service for browser tests, with synthetic storage only."""
from pathlib import Path
import os
import sys
import tempfile
import threading
from unittest.mock import patch
from werkzeug.serving import make_server
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.wrappers import Response

with tempfile.TemporaryDirectory(prefix='hmi-community-browser-') as tmp:
    os.environ['LANDSCAPE_DB']=str(Path(tmp)/'recipes.db')
    os.environ['LANDSCAPE_UPLOAD_DIR']=str(Path(tmp)/'uploads')
    os.environ['AI_MODE']='demo'
    os.environ['SMTP_PASS']=''
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'))
    import ai_service
    with patch.object(ai_service,'dotenv_values',return_value={}), patch('dotenv.dotenv_values',return_value={}):
        import app
    prefix = os.environ.get('HMI_TEST_PREFIX', '')
    application = DispatcherMiddleware(Response('Other site', status=404), {prefix: app.app}) if prefix else app.app
    server=make_server('127.0.0.1',0,application)
    def stop():
        sys.stdin.readline()
        server.shutdown()
    threading.Thread(target=stop,daemon=True).start()
    print('READY http://127.0.0.1:'+str(server.server_port)+(prefix+'/' if prefix else ''),flush=True)
    server.serve_forever()
