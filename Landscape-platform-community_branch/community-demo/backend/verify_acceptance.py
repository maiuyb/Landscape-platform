# -*- coding: utf-8 -*-
"""验收自测：社区配方「存储 / 校验 / 返回结构」。

对应 issue 验收的五条：
  1. v6 保存与详情读取往返后，version、rendering、受支持 steps 一致。
  2. 按配方版本校验；拒绝非有限数值、越界值、未知操作，不删步骤/不改写为 v1。
  3. 旧数据保留语义；缺版本的旧记录仍按 v1，不统一标成 v6。
  4. 往返覆盖 曝光0.8EV、高光-20、HSL、四条曲线、白平衡、细节、暗角/RGB校准、拉直、有效蒙版。
  5. 列表提供可用 id，详情返回完整配方；作品元数据不覆盖配方字段。

运行（在 backend 目录）：
    python verify_acceptance.py
退出码 0 表示全部通过。
"""

import os
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix='acc-')
os.environ['LANDSCAPE_DB'] = os.path.join(TMP, 'acceptance.db')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402
from db import get_db  # noqa: E402

client = server.app.test_client()
PASS = FAIL = 0


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ok   %s' % name)
    else:
        FAIL += 1
        print('  FAIL %s   %s' % (name, extra))


def auth(token):
    return {'Authorization': 'Bearer ' + token}


def publish(recipe, headers, raw=None):
    if raw is not None:
        return client.post('/api/recipes', data=raw, content_type='application/json', headers=headers)
    return client.post('/api/recipes', json={'recipe': recipe}, headers=headers)


def make_v6(name='v6测试'):
    controls = {
        'exposure': 0.8, 'contrast': 0, 'highlights': -20, 'shadows': 0,
        'whites': 0, 'blacks': 0, 'brightness': 0, 'temperature': 0,
        'tint': 0, 'saturation': 0, 'vibrance': 0,
    }
    steps = [
        {'type': 'rotate', 'params': {'angle': 0}},
        {'type': 'flip', 'params': {'direction': 'h'}},
        {'type': 'crop', 'params': {'unit': 'normalized', 'x': 0, 'y': 0, 'width': 1, 'height': 1}},
        {'type': 'straighten', 'params': {'angle': 3.5, 'autoCrop': True}},
    ]
    steps += [{'type': k, 'params': {'value': v}} for k, v in controls.items()]
    steps.append({'type': 'detail', 'params': {'sharpen': 30, 'radius': 1.2, 'protection': 10, 'luminance': 20, 'color': 15}})
    steps.append({'type': 'effects', 'params': {
        'clarity': 12, 'dehaze': 5,
        'calibration': {'red': {'hue': 10, 'saturation': 8}, 'green': {'hue': -5, 'saturation': 4}, 'blue': {'hue': 6, 'saturation': -3}},
        'vignette': {'amount': -30, 'midpoint': 50, 'feather': 70, 'roundness': 20, 'centerX': 50, 'centerY': 50},
    }})
    steps.append({'type': 'masks', 'params': {'layers': [{
        'id': 'm1', 'name': '画笔', 'type': 'brush', 'visible': True, 'invert': False,
        'opacity': 80, 'feather': 60,
        'start': [0.25, 0.5], 'end': [0.75, 0.5], 'center': [0.5, 0.5], 'radius': [0.25, 0.25],
        'strokes': [{'erase': False, 'radius': 0.1, 'feather': 0.5, 'points': [[0.4, 0.4], [0.5, 0.5]]}],
        'adjustments': {'exposure': 0.5, 'contrast': 0, 'highlights': 0, 'shadows': 0,
                        'temperature': 0, 'tint': 0, 'saturation': 10, 'clarity': 0, 'dehaze': 0},
    }]}})
    steps.append({'type': 'white-balance', 'params': {'gains': [1.05, 1.0, 0.98], 'mode': 'custom', 'model': 'relative'}})
    for band in ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']:
        steps.append({'type': 'hsl', 'params': {'band': band, 'hue': 5, 'saturation': 8, 'luminance': -4}})
    for ch in ['master', 'red', 'green', 'blue']:
        steps.append({'type': 'curve', 'params': {'channel': ch, 'points': [[0, 0], [0.5, 0.55], [1, 1]]}})
    steps.append({'type': 'filter', 'params': {'name': 'film', 'strength': 80}})
    return {'name': name, 'version': 6, 'rendering': {'legacyTone': {'highlights': False, 'shadows': False}}, 'steps': steps}


# ---- 登录 ----
reg = client.post('/api/auth/register', json={'username': 'u1', 'password': 'pass1'})
h = auth(reg.get_json()['token'])

# ===== 验收 1 & 4：v6 往返一致 =====
print('[1/4] v6 往返一致')
recipe = make_v6()
r = publish(recipe, h)
check('发布 v6 返回 201', r.status_code == 201, r.get_data(as_text=True))
rid = r.get_json()['id']
d = client.get('/api/recipes/%d' % rid).get_json()['recipe']
check('往返 version=6', d['version'] == 6, d.get('version'))
check('往返 rendering 一致', d['rendering'] == recipe['rendering'], d.get('rendering'))
check('往返 steps 一致（无丢失）', d['steps'] == recipe['steps'])
check('曝光 0.8EV 保留', any(s['type'] == 'exposure' and s['params']['value'] == 0.8 for s in d['steps']))
check('高光 -20 保留', any(s['type'] == 'highlights' and s['params']['value'] == -20 for s in d['steps']))
check('HSL 8 段', len([s for s in d['steps'] if s['type'] == 'hsl']) == 8)
check('四条曲线', len([s for s in d['steps'] if s['type'] == 'curve']) == 4)
check('白平衡保留', any(s['type'] == 'white-balance' for s in d['steps']))
check('细节保留', any(s['type'] == 'detail' for s in d['steps']))
check('暗角/RGB校准保留', any(s['type'] == 'effects' and 'vignette' in s['params'] and 'calibration' in s['params'] for s in d['steps']))
check('拉直保留', any(s['type'] == 'straighten' for s in d['steps']))
check('有效蒙版保留', any(s['type'] == 'masks' and len(s['params']['layers']) == 1 for s in d['steps']))

# ===== 验收 2：按版本校验，拒绝非法 =====
print('[2/4] 校验与拒绝')
check('拒绝未知操作', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'hack', 'params': {}}]}, h).status_code == 400)
check('拒绝越界值(曝光50/v6)', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'exposure', 'params': {'value': 50}}]}, h).status_code == 400)
check('拒绝非有限数值(NaN)',
      publish(None, h, raw='{"recipe":{"name":"x","version":6,"steps":[{"type":"exposure","params":{"value":NaN}}]}}').status_code == 400)
check('拒绝非法版本(9)', publish({'name': 'x', 'version': 9, 'steps': []}, h).status_code == 400)
check('拒绝越界曲线', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'curve', 'params': {'channel': 'master', 'points': [[0, 0], [0.5, 2], [1, 1]]}}]}, h).status_code == 400)
check('拒绝损坏蒙版', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'masks', 'params': {'layers': [{'id': 'm', 'type': 'brush'}]}}]}, h).status_code == 400)
# issue #3：非法集合字段必须是 400（不能 TypeError -> 500）
check('拒绝 filter.name=[]（400 非 500）', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'filter', 'params': {'name': []}}]}, h).status_code == 400)
check('拒绝 curve.channel=[]（400 非 500）', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'curve', 'params': {'channel': []}}]}, h).status_code == 400)
check('拒绝 hsl.band=[]（400 非 500）', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'hsl', 'params': {'band': [], 'hue': 0, 'saturation': 0, 'luminance': 0}}]}, h).status_code == 400)
check('拒绝 type=[]（400 非 500）', publish({'name': 'x', 'version': 6, 'steps': [{'type': []}]}, h).status_code == 400)
check('拒绝 masks.type=[]（400 非 500）', publish({'name': 'x', 'version': 6, 'steps': [{'type': 'masks', 'params': {'layers': [{'id': 'm', 'name': 'x', 'type': [], 'visible': True, 'invert': False, 'opacity': 1, 'feather': 1, 'start': [0, 0], 'end': [1, 1], 'center': [0.5, 0.5], 'radius': [0.1, 0.1], 'adjustments': {'exposure': 0, 'contrast': 0, 'highlights': 0, 'shadows': 0, 'temperature': 0, 'tint': 0, 'saturation': 0, 'clarity': 0, 'dehaze': 0}, 'strokes': []}]}}]}, h).status_code == 400)
before = client.get('/api/recipes').get_json()['total']
publish({'name': '不应落库', 'version': 6, 'steps': [{'type': 'hack', 'params': {}}]}, h)
after = client.get('/api/recipes').get_json()['total']
check('拒绝时不写入库（不靠删步骤兼容）', before == after)
# 版本 1 不接受 v1 不支持的操作（whites）
check('v1 拒绝 v1 不支持的操作(whites)',
      publish({'name': 'x', 'version': 1, 'steps': [{'type': 'whites', 'params': {'value': 10}}]}, h).status_code == 400)

# ===== 验收 3：旧记录仍按 v1 =====
print('[3/4] 旧数据语义')
conn = get_db()
conn.execute("INSERT INTO recipes (name, author, steps) VALUES (?, ?, ?)", ('旧配方', 'legacy', '[]'))
conn.commit()
old_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
conn.close()
od = client.get('/api/recipes/%d' % old_id).get_json()['recipe']
check('旧记录缺版本 -> v1', od['version'] == 1, od.get('version'))
check('旧记录不被标成 v6', od['version'] != 6)
check('旧记录 rendering 为 None/空', od.get('rendering') in (None, {}, ))

# ===== 验收 5：列表/详情/元数据 =====
print('[4/4] 列表与详情结构')
lst = client.get('/api/recipes').get_json()['recipes']
item = next((x for x in lst if x['id'] == rid), None)
check('列表项含可用 id', item is not None and isinstance(item['id'], int))
detail = client.get('/api/recipes/%d' % rid).get_json()['recipe']
check('详情返回完整 steps', isinstance(detail['steps'], list) and len(detail['steps']) == len(recipe['steps']))
check('详情 steps 为数组', isinstance(detail.get('steps'), list))
r = client.post('/api/recipes', json={'recipe': {'name': '元数据测试', 'version': 6, 'steps': []},
                                      'author': 'hacker', 'id': 999, 'favorite_count': 999}, headers=h)
rid3 = r.get_json()['id']
d3 = client.get('/api/recipes/%d' % rid3).get_json()['recipe']
check('元数据不覆盖作者', d3['author'] == 'u1', d3['author'])
check('元数据不覆盖 id', d3['id'] == rid3)
check('元数据不覆盖收藏数', d3['favorite_count'] == 0, d3['favorite_count'])

print('\n=== PASS %d / FAIL %d ===' % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
