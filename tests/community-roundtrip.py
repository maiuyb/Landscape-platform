"""Exercise real Flask endpoints using synthetic recipes and a temporary database.

Optional argv[1]: upstream backend source directory for independent acceptance.
No production data, .env or network calls are read by this runner.
"""
import contextlib
import copy
import importlib.util
import json
import os
import sqlite3
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

recipes=json.loads(sys.stdin.buffer.read().decode('utf-8'))
with tempfile.TemporaryDirectory(prefix='hmi-roundtrip-') as tmp:
    # Begin with the prototype schema, so every run also checks additive migration.
    storage=Path(tmp)/'recipes.db'
    with contextlib.closing(sqlite3.connect(storage)) as conn, conn:
        conn.executescript('''CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,avatar TEXT DEFAULT '',created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE recipes (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,author TEXT NOT NULL,
          description TEXT DEFAULT '',cover_before TEXT DEFAULT '',cover_after TEXT DEFAULT '',steps TEXT DEFAULT '[]',
          features TEXT DEFAULT '{}',likes INTEGER DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);''')
        conn.execute('INSERT INTO recipes (name,author,steps,likes) VALUES (?,?,?,?)',
                     ('retained legacy','synthetic',json.dumps([{'type':'exposure','params':{'value':40}}]),7))
    root=Path(__file__).resolve().parents[1]
    if len(sys.argv)>1:
        backend=Path(sys.argv[1]).resolve()
        sys.path.insert(0,str(backend))
        os.environ['LANDSCAPE_DB']=str(Path(tmp)/'recipes.db')
        import server
        app=server.app
    else:
        backend=root/'风景调色协作平台/backend'
        sys.path.insert(0,str(backend))
        spec=importlib.util.spec_from_file_location('roundtrip_app',backend/'app.py')
        module=importlib.util.module_from_spec(spec)
        import ai_service
        with patch.dict(os.environ,{'LANDSCAPE_DB':str(Path(tmp)/'recipes.db'),'AI_MODE':'demo'}), patch.object(ai_service,'dotenv_values',return_value={}), patch('os.path.abspath',return_value=str(Path(tmp)/'app.py')):
            spec.loader.exec_module(module)
        app=module.app
    c=app.test_client()
    from auth_test_support import seed_user
    reg=seed_user(app, 'synthetic', 'fixture-only')
    headers={'Authorization':'Bearer '+reg['token']}
    output=[]
    for recipe in recipes:
        posted=c.post('/api/recipes',json={'recipe':recipe},headers=headers)
        data=posted.get_json()
        detail=c.get('/api/recipes/'+str(data['id'])).get_json() if posted.status_code==201 else None
        output.append({'status':posted.status_code,'detail':detail,'error':data.get('error')})
    bad=[{'version':6,'steps':[{'type':'unknown','params':{}}]},
         {'version':6,'steps':[{'type':'exposure','params':{'value':9}}]},
         {'version':6,'steps':[{'type':'exposure','params':{'value':float('nan')}}]},
         {'version':6,'steps':[{'type':'curve','params':{'channel':'master','points':[[0,0],[1,2]]}}]},
         {'version':6,'steps':[{'type':'masks','params':{'layers':[{}]}}]},
         {'version':99,'steps':[]}, {'version':True,'steps':[]}]
    # Enum fields must reject unhashable JSON values through the real API, without 500s.
    valid_mask=next(s for s in recipes[0]['steps'] if s['type']=='masks')['params']['layers'][0]
    for value in ([], {}):
        mask=copy.deepcopy(valid_mask);mask['type']=value
        for step in [
            {'type':'filter','params':{'name':value}},
            {'type':'curve','params':{'channel':value,'points':[[0,0],[1,1]]}},
            {'type':'hsl','params':{'band':value,'hue':0,'saturation':0,'luminance':0}},
            {'type':'masks','params':{'layers':[mask]}},
            {'type':value,'params':{}},
        ]:
            bad.append({'version':6,'steps':[step]})
    before=c.get('/api/recipes').get_json()['total']
    rejected=[c.post('/api/recipes',json={'recipe':dict(r,name='invalid')},headers=headers).status_code for r in bad]
    after=c.get('/api/recipes').get_json()['total']
    old=c.get('/api/recipes/1').get_json()['recipe']
    with contextlib.closing(sqlite3.connect(storage)) as conn, conn:
        retained=conn.execute('SELECT likes FROM recipes WHERE id=1').fetchone()[0]==7
    print(json.dumps({'records':output,'rejected':rejected,'unchanged':before==after,'me':c.get('/api/auth/me',headers=headers).status_code,
                      'migration':old['version']==1 and old['steps'][0]['params']['value']==40 and retained},ensure_ascii=True))
