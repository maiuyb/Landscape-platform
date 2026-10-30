"""Loopback-only credits browser fixture: synthetic storage and an in-memory mailbox."""
from pathlib import Path
import os
import re
import sys
import tempfile
import threading
from unittest.mock import patch
from flask import jsonify
from werkzeug.serving import make_server
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.wrappers import Response
with tempfile.TemporaryDirectory(prefix='hmi-credits-browser-') as tmp:
    os.environ.update(LANDSCAPE_DB=str(Path(tmp)/'db.sqlite'),LANDSCAPE_UPLOAD_DIR=str(Path(tmp)/'uploads'),AI_MODE='demo',DASHSCOPE_API_KEY='',SMTP_PASS='')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'))
    with patch('dotenv.dotenv_values',return_value={}):
        import app
    from community_modules import credits
    mailbox=[]
    def mail(to,subject,html):
        assert to.endswith('@example.test')
        mailbox.append(dict(to=to,subject=subject,html=html))
        return dict(sent=True,mode='smtp')
    @app.app.get('/__test/mailbox')
    def messages():return jsonify(mailbox)
    @app.app.get('/__test/codes')
    def code_count():
        conn=app.get_db()
        try:return jsonify(count=conn.execute('SELECT count(*) n FROM redemption_codes').fetchone()['n'])
        finally:conn.close()
    cfg=dict(configured=True,host='unused',port=465,user='synthetic@example.test',password='synthetic-only',admin_email='admin@example.test',public_origin='')
    from auth_test_support import install_fixture
    install_fixture(app.app)
    prefix=os.environ.get('HMI_TEST_PREFIX','')
    application=DispatcherMiddleware(Response('Other site',status=404),{prefix:app.app}) if prefix else app.app
    with patch.object(credits,'_smtp_config',return_value=cfg),patch.object(credits,'send_email_163',side_effect=mail):
        server=make_server('127.0.0.1',0,application,threaded=True)
        def stop():sys.stdin.readline();server.shutdown()
        threading.Thread(target=stop,daemon=True).start()
        print('READY http://127.0.0.1:'+str(server.server_port)+(prefix+'/' if prefix else ''),flush=True)
        server.serve_forever()
